import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';
import { checksumSha256, decrypt, deriveKey, encrypt } from '../../src/lib/crypto.js';
import { diffManifests, emptyManifest, type Manifest } from '../../src/lib/manifest.js';
import { LocalFilesystemBackend } from '../../src/storage/local.js';
import { encodeProjectPath } from '../../src/lib/path-encoder.js';
import { remapJsonlBuffer } from '../../src/lib/jsonl-remapper.js';

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

  it('A→pull on B→sync from B: A sessions survive in shared storage', async () => {
    // This is the scenario that breaks naive bidirectional sync:
    //   1. A syncs  → remote has A's sessions under encodedA
    //   2. B pulls  → A's sessions remapped to B's paths, written under encodedB
    //   3. B syncs  → B's disk only has encodedB; should NOT delete encodedA from remote

    const derived = deriveKey('correct-horse-battery-staple', 'a@example.com');
    const backend = new LocalFilesystemBackend(remote);
    const PATH_A = '/home/machineA/myapp';
    const PATH_B = '/home/machineB/myapp';
    const encodedA = encodeProjectPath(PATH_A);
    const encodedB = encodeProjectPath(PATH_B);

    // ── 1. Machine A syncs ──────────────────────────────────────────────────
    const aSessionLines = [
      JSON.stringify({ cwd: PATH_A, type: 'system', uuid: 'u1' }),
      JSON.stringify({ cwd: PATH_A, type: 'user',   uuid: 'u2' }),
    ].join('\n') + '\n';
    const aSession = Buffer.from(aSessionLines);
    await mkdir(join(machineA, 'projects', encodedA), { recursive: true });
    await writeFile(join(machineA, 'projects', encodedA, 'session.jsonl'), aSession);

    const adapterA = new ClaudeCodeAdapter(machineA);
    const aSyncManifest: Manifest = { ...emptyManifest('claude-code'), projects: {} };
    for await (const f of adapterA.getFiles()) {
      const enc = encrypt(f.content, derived);
      aSyncManifest.files[f.relativePath] = {
        checksum: checksumSha256(f.content), size: f.content.length, encryptedSize: enc.length,
      };
      await backend.write('files/' + f.relativePath, enc);
    }
    aSyncManifest.projects![encodedA] = { projectId: null, originalPath: PATH_A };
    await backend.write('manifest.json.enc',
      encrypt(Buffer.from(JSON.stringify(aSyncManifest), 'utf-8'), derived));

    // ── 2. Machine B pulls (download, remap A→B, write to B's disk) ─────────
    const remoteBlob = await backend.read('manifest.json.enc');
    const remoteManifest = JSON.parse(decrypt(remoteBlob, derived).toString('utf-8')) as Manifest;

    const aFilePath = `projects/${encodedA}/session.jsonl`;
    const aBlob = await backend.read('files/' + aFilePath);
    const aDecrypted = decrypt(aBlob, derived);
    const bRemapped = remapJsonlBuffer(aDecrypted, PATH_A, PATH_B);
    const bFilePath = `projects/${encodedB}/session.jsonl`;

    const adapterB = new ClaudeCodeAdapter(machineB);
    await adapterB.putFiles((async function* () {
      yield { relativePath: bFilePath, content: bRemapped };
    })());

    // B's local manifest after pull reflects the remapped on-disk state (pull.ts fix).
    const bPullManifest: Manifest = { ...remoteManifest, files: { ...remoteManifest.files } };
    delete bPullManifest.files[aFilePath];
    bPullManifest.files[bFilePath] = {
      checksum: checksumSha256(bRemapped),
      size: bRemapped.length,
      encryptedSize: remoteManifest.files[aFilePath].encryptedSize,
    };
    // (In production this is saved to disk; here we hold it in memory for the next step.)

    // ── 3. Machine B syncs ──────────────────────────────────────────────────
    const bContents = new Map<string, Buffer>();
    for await (const f of adapterB.getFiles()) bContents.set(f.relativePath, f.content);

    const localProjectDirs = new Set<string>();
    for (const p of bContents.keys()) {
      const pm = p.match(/^projects\/([^/]+)\//);
      if (pm) localProjectDirs.add(pm[1]);
    }
    // localProjectDirs = {encodedB}  — encodedA is absent

    const bDiskManifest: Manifest = emptyManifest('claude-code');
    for (const [path, content] of bContents) {
      bDiskManifest.files[path] = { checksum: checksumSha256(content), size: content.length, encryptedSize: 0 };
    }

    const diff = diffManifests(bDiskManifest, remoteManifest);
    // diff.removed includes aFilePath (in remote, absent on B's disk)
    // diff.added   includes bFilePath (on B's disk, absent in remote)

    for (const path of diff.removed) {
      const pm = path.match(/^projects\/([^/]+)\//);
      if (pm && !localProjectDirs.has(pm[1])) continue; // ← the fix being tested
      await backend.remove('files/' + path);
    }
    for (const path of diff.added) {
      await backend.write('files/' + path, encrypt(bContents.get(path)!, derived));
    }

    // ── Verify ───────────────────────────────────────────────────────────────
    // A's original sessions must NOT have been deleted by B's sync
    expect(await backend.has(`files/${aFilePath}`)).toBe(true);
    // B's remapped sessions must now be in shared storage
    expect(await backend.has(`files/${bFilePath}`)).toBe(true);
    // B's uploaded content has B's paths, not A's
    const bUploaded = decrypt(await backend.read(`files/${bFilePath}`), derived).toString('utf-8');
    expect(bUploaded).toContain(PATH_B);
    expect(bUploaded).not.toContain(PATH_A);
  });

  it('Machine B sync does not delete Machine A sessions (bidirectional coexistence)', async () => {
    const derived = deriveKey('correct-horse-battery-staple', 'a@example.com');
    const backend = new LocalFilesystemBackend(remote);

    const encodedA = encodeProjectPath('/home/machineA/myapp');
    const encodedB = encodeProjectPath('/home/machineB/myapp');

    // Seed remote: Machine A's session already synced
    const aSession = Buffer.from('{"cwd":"/home/machineA/myapp","type":"system"}\n');
    const aPath = `projects/${encodedA}/a-session.jsonl`;
    await backend.write(`files/${aPath}`, encrypt(aSession, derived));
    const remoteManifest: Manifest = emptyManifest('claude-code');
    remoteManifest.files[aPath] = {
      checksum: checksumSha256(aSession),
      size: aSession.length,
      encryptedSize: aSession.length,
    };
    await backend.write('manifest.json.enc',
      encrypt(Buffer.from(JSON.stringify(remoteManifest), 'utf-8'), derived));

    // Machine B has only its own session — A's project dir is absent locally
    const bSession = Buffer.from('{"cwd":"/home/machineB/myapp","type":"system"}\n');
    await mkdir(join(machineB, 'projects', encodedB), { recursive: true });
    await writeFile(join(machineB, 'projects', encodedB, 'b-session.jsonl'), bSession);

    // Simulate Machine B running syncCommand (the core logic, without prompts)
    const adapterB = new ClaudeCodeAdapter(machineB);
    const bContents = new Map<string, Buffer>();
    for await (const f of adapterB.getFiles()) {
      bContents.set(f.relativePath, f.content);
    }

    // Build localProjectDirs (the guard in sync.ts)
    const localProjectDirs = new Set<string>();
    for (const p of bContents.keys()) {
      const pm = p.match(/^projects\/([^/]+)\//);
      if (pm) localProjectDirs.add(pm[1]);
    }

    const bManifest: Manifest = emptyManifest('claude-code');
    for (const [path, content] of bContents) {
      bManifest.files[path] = { checksum: checksumSha256(content), size: content.length, encryptedSize: 0 };
    }

    const diff = diffManifests(bManifest, remoteManifest);

    // Apply the guarded removal (mirrors sync.ts fix — skip other machines' project dirs)
    for (const path of diff.removed) {
      const pm = path.match(/^projects\/([^/]+)\//);
      if (pm && !localProjectDirs.has(pm[1])) continue; // guard: not our project
      await backend.remove('files/' + path);
    }
    // Upload B's new files
    for (const path of diff.added) {
      await backend.write('files/' + path, encrypt(bContents.get(path)!, derived));
    }

    // Machine A's session must still exist in shared storage
    expect(await backend.has(`files/${aPath}`)).toBe(true);
    // Machine B's session must now exist too
    expect(await backend.has(`files/projects/${encodedB}/b-session.jsonl`)).toBe(true);
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
