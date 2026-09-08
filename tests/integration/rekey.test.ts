import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decrypt, deriveKeyFromSalt } from '../../src/lib/crypto.js';
import { decompress } from '../../src/lib/compress.js';
import { LocalFilesystemBackend } from '../../src/storage/local.js';
import { remoteFilePath, remoteManifestPath, remoteSaltPath } from '../../src/lib/project-storage-paths.js';
import { resolveProjectKey } from '../../src/lib/project-identifier.js';
import { localSessionsDir } from '../../src/lib/team-sessions.js';
import type { syncCommand as SyncCommandFn } from '../../src/commands/sync.js';
import type { pullCommand as PullCommandFn } from '../../src/commands/pull.js';
import type { rekeyCommand as RekeyCommandFn } from '../../src/commands/rekey.js';

describe('cortex rekey', () => {
  let claudeHomeA: string;
  let claudeHomeB: string;
  let project: string;
  let remote: string;
  let syncCommand: typeof SyncCommandFn;
  let pullCommand: typeof PullCommandFn;
  let rekeyCommand: typeof RekeyCommandFn;
  const email = 'dev@example.com';
  const passphrase = 'correct-horse-battery-staple';

  beforeEach(async () => {
    claudeHomeA = await mkdtemp(join(tmpdir(), 'cortex-home-'));
    claudeHomeB = await mkdtemp(join(tmpdir(), 'cortex-home-'));
    project = await mkdtemp(join(tmpdir(), 'cortex-proj-'));
    remote = await mkdtemp(join(tmpdir(), 'cortex-remote-'));
    vi.stubEnv('CORTEX_PASSPHRASE', passphrase);
    await writeFile(join(project, 'cortex.json'), JSON.stringify({ projectId: 'rekey-test' }));

    for (const home of [claudeHomeA, claudeHomeB]) {
      await mkdir(join(home, '.cortex'), { recursive: true });
      await writeFile(
        join(home, '.cortex', 'config.json'),
        JSON.stringify({ version: 1, storage: 'local', email, tools: [], createdAt: new Date().toISOString() }),
      );
    }
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(claudeHomeA, { recursive: true, force: true });
    await rm(claudeHomeB, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
    await rm(remote, { recursive: true, force: true });
  });

  it('refuses to rekey a project that has never been synced', async () => {
    vi.stubEnv('HOME', claudeHomeA);
    vi.resetModules();
    ({ rekeyCommand } = await import('../../src/commands/rekey.js'));

    await expect(rekeyCommand({ target: remote, cwd: project })).rejects.toThrow(/sync/i);
  });

  it('rotates the salt and old key/salt no longer decrypt the content', async () => {
    vi.stubEnv('HOME', claudeHomeA);
    await mkdir(localSessionsDir(project), { recursive: true });
    await writeFile(join(localSessionsDir(project), 'a.jsonl'), '{"cwd":"/home/alice/app"}\n');

    vi.resetModules();
    ({ syncCommand } = await import('../../src/commands/sync.js'));
    await syncCommand({ target: remote, cwd: project, skipSecretsCheck: true });

    const { projectKey } = resolveProjectKey(project);
    const backend = new LocalFilesystemBackend(remote);
    const oldSalt = await backend.read(remoteSaltPath(projectKey));
    const oldDerived = deriveKeyFromSalt(passphrase, oldSalt);

    vi.resetModules();
    ({ rekeyCommand } = await import('../../src/commands/rekey.js'));
    await rekeyCommand({ target: remote, cwd: project });

    const newSalt = await backend.read(remoteSaltPath(projectKey));
    expect(newSalt.equals(oldSalt)).toBe(false);

    const filePath = remoteFilePath(projectKey, 'sessions/a.jsonl');
    const blob = await backend.read(filePath);
    expect(() => decrypt(blob, oldDerived, Buffer.from(filePath))).toThrow();

    const newDerived = deriveKeyFromSalt(passphrase, newSalt);
    const restored = decompress(decrypt(blob, newDerived, Buffer.from(filePath)));
    expect(restored.toString('utf-8')).toBe('{"cwd":"/home/alice/app"}\n');
  });

  it('another machine can still pull the exact same content after a rekey', async () => {
    vi.stubEnv('HOME', claudeHomeA);
    await mkdir(localSessionsDir(project), { recursive: true });
    await writeFile(join(localSessionsDir(project), 'a.jsonl'), '{"cwd":"/home/alice/app"}\n');
    vi.resetModules();
    ({ syncCommand } = await import('../../src/commands/sync.js'));
    await syncCommand({ target: remote, cwd: project, skipSecretsCheck: true });

    vi.resetModules();
    ({ rekeyCommand } = await import('../../src/commands/rekey.js'));
    await rekeyCommand({ target: remote, cwd: project });

    vi.stubEnv('HOME', claudeHomeB);
    vi.resetModules();
    ({ pullCommand } = await import('../../src/commands/pull.js'));
    await pullCommand({ target: remote, cwd: project, nonInteractive: true });

    const { readFile } = await import('node:fs/promises');
    const restored = await readFile(join(localSessionsDir(project), 'a.jsonl'), 'utf-8');
    expect(restored).toBe('{"cwd":"/home/alice/app"}\n');
  });

  it('remote manifest stays intact and readable with the new key after rekey', async () => {
    vi.stubEnv('HOME', claudeHomeA);
    await mkdir(localSessionsDir(project), { recursive: true });
    await writeFile(join(localSessionsDir(project), 'a.jsonl'), '{"cwd":"/home/alice/app"}\n');
    vi.resetModules();
    ({ syncCommand } = await import('../../src/commands/sync.js'));
    await syncCommand({ target: remote, cwd: project, skipSecretsCheck: true });

    vi.resetModules();
    ({ rekeyCommand } = await import('../../src/commands/rekey.js'));
    await rekeyCommand({ target: remote, cwd: project });

    const { projectKey } = resolveProjectKey(project);
    const backend = new LocalFilesystemBackend(remote);
    const newSalt = await backend.read(remoteSaltPath(projectKey));
    const newDerived = deriveKeyFromSalt(passphrase, newSalt);
    const manifestPath = remoteManifestPath(projectKey);
    const enc = await backend.read(manifestPath);
    const manifest = JSON.parse(decompress(decrypt(enc, newDerived, Buffer.from(manifestPath))).toString('utf-8'));
    expect(Object.keys(manifest.files)).toContain('sessions/a.jsonl');
  });
});
