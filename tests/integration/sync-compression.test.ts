import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decrypt, deriveKey } from '../../src/lib/crypto.js';
import { decompress } from '../../src/lib/compress.js';
import { LocalFilesystemBackend } from '../../src/storage/local.js';
import { remoteFilePath } from '../../src/lib/project-storage-paths.js';
import { resolveProjectKey } from '../../src/lib/project-identifier.js';
import { localSessionsDir } from '../../src/lib/team-sessions.js';
import type { syncCommand as SyncCommandFn } from '../../src/commands/sync.js';
import type { pullCommand as PullCommandFn } from '../../src/commands/pull.js';

describe('cortex sync compresses before encrypting (and pull decompresses back)', () => {
  let claudeHomeA: string;
  let claudeHomeB: string;
  let project: string;
  let remote: string;
  let syncCommand: typeof SyncCommandFn;
  let pullCommand: typeof PullCommandFn;
  const email = 'dev@example.com';
  const passphrase = 'correct-horse-battery-staple';
  const derived = deriveKey(passphrase, email);
  // Real JSONL sessions are highly repetitive — a big enough sample proves compression happened.
  const sessionLine = `{"cwd":"/home/alice/myapp","type":"user","uuid":"a1b2c3d4","message":"same line repeated"}\n`;
  const bigSession = sessionLine.repeat(500); // ~40KB of very repetitive text

  beforeEach(async () => {
    claudeHomeA = await mkdtemp(join(tmpdir(), 'cortex-home-'));
    claudeHomeB = await mkdtemp(join(tmpdir(), 'cortex-home-'));
    project = await mkdtemp(join(tmpdir(), 'cortex-proj-'));
    remote = await mkdtemp(join(tmpdir(), 'cortex-remote-'));
    vi.stubEnv('CORTEX_PASSPHRASE', passphrase);
    await writeFile(
      join(project, 'cortex.json'),
      JSON.stringify({ projectId: 'compression-test' }),
    );

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

  it('the uploaded blob is smaller than the raw session and only readable after decompressing', async () => {
    vi.stubEnv('HOME', claudeHomeA);
    await mkdir(localSessionsDir(project), { recursive: true });
    await writeFile(join(localSessionsDir(project), 'big.jsonl'), bigSession);

    vi.resetModules();
    ({ syncCommand } = await import('../../src/commands/sync.js'));
    await syncCommand({ target: remote, cwd: project, skipSecretsCheck: true });

    const { projectKey } = resolveProjectKey(project);
    const backend = new LocalFilesystemBackend(remote);
    const blob = await backend.read(remoteFilePath(projectKey, 'sessions/big.jsonl'));
    const decrypted = decrypt(blob, derived);

    // Decrypted-but-not-decompressed bytes must NOT be the readable JSONL —
    // proves compress() actually ran before encrypt().
    expect(decrypted.toString('utf-8')).not.toContain('same line repeated');
    expect(decrypted.length).toBeLessThan(bigSession.length / 3);

    const decompressed = decompress(decrypted);
    expect(decompressed.toString('utf-8')).toBe(bigSession);
  });

  it('pull restores the exact original bytes on another machine', async () => {
    vi.stubEnv('HOME', claudeHomeA);
    await mkdir(localSessionsDir(project), { recursive: true });
    await writeFile(join(localSessionsDir(project), 'big.jsonl'), bigSession);
    vi.resetModules();
    ({ syncCommand } = await import('../../src/commands/sync.js'));
    await syncCommand({ target: remote, cwd: project, skipSecretsCheck: true });

    vi.stubEnv('HOME', claudeHomeB);
    vi.resetModules();
    ({ pullCommand } = await import('../../src/commands/pull.js'));
    await pullCommand({ target: remote, cwd: project, nonInteractive: true });

    const { readFile } = await import('node:fs/promises');
    const restored = await readFile(join(localSessionsDir(project), 'big.jsonl'), 'utf-8');
    expect(restored).toBe(bigSession);
  });
});
