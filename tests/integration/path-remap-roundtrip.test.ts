/**
 * End-to-end: Machine A syncs a project at /old/path, Machine B pulls it
 * and the JSONL lands at /new/path with all structural fields remapped.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';
import { checksumSha256, decrypt, deriveKey, encrypt } from '../../src/lib/crypto.js';
import { diffManifests, emptyManifest, type Manifest } from '../../src/lib/manifest.js';
import { LocalFilesystemBackend } from '../../src/storage/local.js';
import { encodeProjectPath } from '../../src/lib/path-encoder.js';
import { remapJsonlBuffer, extractCwdFromJsonl } from '../../src/lib/jsonl-remapper.js';

describe('path-remap round-trip', () => {
  let machineA: string;
  let machineB: string;
  let remote: string;

  const OLD_PROJECT = '/home/machineA/work/myapp';
  const NEW_PROJECT = '/home/machineB/projects/myapp';

  const SESSION_JSONL = [
    JSON.stringify({ type: 'system', cwd: OLD_PROJECT, uuid: 'u1' }),
    JSON.stringify({
      type: 'user',
      cwd: OLD_PROJECT,
      uuid: 'u2',
      message: {
        role: 'user',
        content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: OLD_PROJECT + '/index.ts' } }],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      cwd: OLD_PROJECT,
      uuid: 'u3',
      toolUseResult: { filePath: OLD_PROJECT + '/index.ts', content: 'export {}' },
    }),
    JSON.stringify({
      type: 'assistant',
      cwd: OLD_PROJECT,
      uuid: 'u4',
      toolUseResult: { stdout: OLD_PROJECT, stderr: '' },
    }),
  ].join('\n') + '\n';

  beforeEach(async () => {
    machineA = await mkdtemp(join(tmpdir(), 'cortex-remap-A-'));
    machineB = await mkdtemp(join(tmpdir(), 'cortex-remap-B-'));
    remote = await mkdtemp(join(tmpdir(), 'cortex-remap-remote-'));
  });

  afterEach(async () => {
    await rm(machineA, { recursive: true, force: true });
    await rm(machineB, { recursive: true, force: true });
    await rm(remote, { recursive: true, force: true });
  });

  it('structural fields are remapped; historical fields are preserved', async () => {
    const oldEncoded = encodeProjectPath(OLD_PROJECT);
    const newEncoded = encodeProjectPath(NEW_PROJECT);

    // 1. Seed Machine A: one project directory with a session JSONL
    const projectDirA = join(machineA, 'projects', oldEncoded);
    await mkdir(projectDirA, { recursive: true });
    await writeFile(join(projectDirA, 'session.jsonl'), SESSION_JSONL);

    const derived = deriveKey('correct-horse-battery-staple', 'a@example.com');
    const backend = new LocalFilesystemBackend(remote);
    const adapterA = new ClaudeCodeAdapter(machineA);

    // 2. SYNC from A (simplified: no project detection needed for this test)
    const localManifest: Manifest = emptyManifest('claude-code');
    localManifest.projects = {};
    const contents = new Map<string, Buffer>();
    for await (const f of adapterA.getFiles()) {
      contents.set(f.relativePath, f.content);
      localManifest.files[f.relativePath] = {
        checksum: checksumSha256(f.content),
        size: f.content.length,
        encryptedSize: 0,
      };
    }
    // Manually inject project metadata (as syncCommand would do)
    localManifest.projects[oldEncoded] = {
      projectId: null,
      originalPath: OLD_PROJECT,
    };
    for (const [path, content] of contents) {
      const enc = encrypt(content, derived);
      localManifest.files[path].encryptedSize = enc.length;
      await backend.write('files/' + path, enc);
    }
    const encManifest = encrypt(Buffer.from(JSON.stringify(localManifest), 'utf-8'), derived);
    await backend.write('manifest.json.enc', encManifest);

    // 3. PULL on B — simulate the remapping logic from pull.ts
    const adapterB = new ClaudeCodeAdapter(machineB);
    const remoteManifestBlob = await backend.read('manifest.json.enc');
    const remoteManifest = JSON.parse(
      decrypt(remoteManifestBlob, derived).toString('utf-8'),
    ) as Manifest;

    const diff = diffManifests(remoteManifest, emptyManifest('claude-code'));

    async function* gen() {
      for (const path of diff.added) {
        const blob = await backend.read('files/' + path);
        const content = decrypt(blob, derived);

        const m = path.match(/^(projects\/([^/]+))\/(.*\.jsonl)$/);
        if (m && remoteManifest.projects?.[m[2]]) {
          const { originalPath } = remoteManifest.projects[m[2]];
          const remapped = remapJsonlBuffer(content, originalPath, NEW_PROJECT);
          const newPath = `projects/${newEncoded}/${m[3]}`;
          yield { relativePath: newPath, content: remapped };
        } else {
          yield { relativePath: path, content };
        }
      }
    }
    await adapterB.putFiles(gen());

    // 4. Verify: file landed at new encoded dir
    const sessionOnB = await readFile(join(machineB, 'projects', newEncoded, 'session.jsonl'));
    const lines = sessionOnB
      .toString('utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    // cwd fields remapped
    for (const line of lines) {
      if ('cwd' in line) expect(line['cwd']).toBe(NEW_PROJECT);
    }

    // structural file_path remapped
    const userLine = lines.find((l) => {
      const msg = l['message'] as { content: Array<{ input?: { file_path?: string } }> } | undefined;
      return msg?.content?.[0]?.input?.file_path !== undefined;
    });
    expect(userLine).toBeDefined();
    const filePath = (
      (userLine!['message'] as { content: Array<{ input: { file_path: string } }> }).content[0]
        .input.file_path
    );
    expect(filePath).toBe(NEW_PROJECT + '/index.ts');

    // structural toolUseResult.filePath remapped
    const toolLine = lines.find(
      (l) => (l['toolUseResult'] as { filePath?: string } | undefined)?.filePath !== undefined,
    );
    expect(toolLine).toBeDefined();
    expect((toolLine!['toolUseResult'] as { filePath: string }).filePath).toBe(
      NEW_PROJECT + '/index.ts',
    );

    // historical stdout NOT remapped
    const stdoutLine = lines.find(
      (l) => (l['toolUseResult'] as { stdout?: string } | undefined)?.stdout !== undefined,
    );
    expect(stdoutLine).toBeDefined();
    expect((stdoutLine!['toolUseResult'] as { stdout: string }).stdout).toBe(OLD_PROJECT);

    // extractCwdFromJsonl reads new path from remapped content
    expect(extractCwdFromJsonl(sessionOnB)).toBe(NEW_PROJECT);
  });
});
