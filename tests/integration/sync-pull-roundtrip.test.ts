import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';
import { checksumSha256, decrypt, deriveKey, encrypt } from '../../src/lib/crypto.js';
import { diffManifests, emptyManifest, type Manifest } from '../../src/lib/manifest.js';
import { LocalFilesystemBackend } from '../../src/storage/local.js';

// End-to-end: simulate machine A syncing files, then machine B pulling them.
// Uses the same primitives the real CLI uses, but skips the prompt layer.
describe('sync→pull round-trip via LocalFilesystemBackend', () => {
  let machineA: string;
  let machineB: string;
  let remote: string;

  beforeEach(async () => {
    machineA = await mkdtemp(join(tmpdir(), 'cortex-A-'));
    machineB = await mkdtemp(join(tmpdir(), 'cortex-B-'));
    remote = await mkdtemp(join(tmpdir(), 'cortex-remote-'));
  });

  afterEach(async () => {
    await rm(machineA, { recursive: true, force: true });
    await rm(machineB, { recursive: true, force: true });
    await rm(remote, { recursive: true, force: true });
  });

  it('files written on A appear identically on B after sync→pull', async () => {
    // 1. Seed machineA with files
    await mkdir(join(machineA, 'projects', 'foo'), { recursive: true });
    await writeFile(join(machineA, 'settings.json'), '{"key":"value"}');
    await writeFile(join(machineA, 'projects', 'foo', 'session.jsonl'), 'line1\nline2\n');

    const derived = deriveKey('correct-horse-battery-staple', 'a@example.com');
    const backend = new LocalFilesystemBackend(remote);
    const adapterA = new ClaudeCodeAdapter(machineA);

    // 2. SYNC from A
    const localManifest: Manifest = emptyManifest('claude-code');
    const contents = new Map<string, Buffer>();
    for await (const f of adapterA.getFiles()) {
      contents.set(f.relativePath, f.content);
      localManifest.files[f.relativePath] = {
        checksum: checksumSha256(f.content),
        size: f.content.length,
        encryptedSize: 0,
      };
    }
    for (const [path, content] of contents) {
      const enc = encrypt(content, derived);
      localManifest.files[path].encryptedSize = enc.length;
      await backend.write('files/' + path, enc);
    }
    const encManifest = encrypt(Buffer.from(JSON.stringify(localManifest), 'utf-8'), derived);
    await backend.write('manifest.json.enc', encManifest);

    // 3. PULL on B
    const adapterB = new ClaudeCodeAdapter(machineB);
    const remoteManifestBlob = await backend.read('manifest.json.enc');
    const remoteManifest = JSON.parse(
      decrypt(remoteManifestBlob, derived).toString('utf-8'),
    ) as Manifest;

    const diff = diffManifests(remoteManifest, emptyManifest('claude-code'));
    expect(diff.added.sort()).toEqual(['projects/foo/session.jsonl', 'settings.json']);

    async function* gen() {
      for (const path of diff.added) {
        const blob = await backend.read('files/' + path);
        const content = decrypt(blob, derived);
        const expected = remoteManifest.files[path].checksum;
        const actual = checksumSha256(content);
        expect(actual).toBe(expected);
        yield { relativePath: path, content };
      }
    }
    await adapterB.putFiles(gen());

    // 4. Verify byte equality A vs B
    const onA = await readFile(join(machineA, 'projects', 'foo', 'session.jsonl'));
    const onB = await readFile(join(machineB, 'projects', 'foo', 'session.jsonl'));
    expect(onB.equals(onA)).toBe(true);

    const settingsA = await readFile(join(machineA, 'settings.json'));
    const settingsB = await readFile(join(machineB, 'settings.json'));
    expect(settingsB.equals(settingsA)).toBe(true);
  });
});
