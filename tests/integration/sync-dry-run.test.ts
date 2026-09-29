import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFilesystemBackend } from '../../src/storage/local.js';
import { remoteManifestPath } from '../../src/lib/project-storage-paths.js';
import { resolveProjectKey } from '../../src/lib/project-identifier.js';
import { localManifestPath } from '../../src/lib/project-storage-paths.js';
import { localSessionsDir } from '../../src/lib/team-sessions.js';
import type { syncCommand as SyncCommandFn } from '../../src/commands/sync.js';

describe('cortex sync --dry-run', () => {
  let claudeHome: string;
  let project: string;
  let remote: string;
  let syncCommand: typeof SyncCommandFn;
  const email = 'dev@example.com';
  const passphrase = 'correct-horse-battery-staple';

  beforeEach(async () => {
    claudeHome = await mkdtemp(join(tmpdir(), 'cortex-home-'));
    project = await mkdtemp(join(tmpdir(), 'cortex-proj-'));
    remote = await mkdtemp(join(tmpdir(), 'cortex-remote-'));
    vi.stubEnv('HOME', claudeHome);
    vi.stubEnv('CORTEX_PASSPHRASE', passphrase);
    await mkdir(join(claudeHome, '.cortex'), { recursive: true });
    await writeFile(
      join(claudeHome, '.cortex', 'config.json'),
      JSON.stringify({ version: 1, storage: 'local', email, tools: [], createdAt: new Date().toISOString() }),
    );
    await writeFile(join(project, 'cortex.json'), JSON.stringify({ projectId: 'dry-run-test' }));
    await mkdir(localSessionsDir(project), { recursive: true });
    await writeFile(join(localSessionsDir(project), 'a.jsonl'), '{"cwd":"/home/alice/app"}\n');

    vi.resetModules();
    ({ syncCommand } = await import('../../src/commands/sync.js'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(claudeHome, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
    await rm(remote, { recursive: true, force: true });
  });

  it('does not upload anything on a first sync', async () => {
    await syncCommand({ target: remote, cwd: project, skipSecretsCheck: true, dryRun: true });

    const { projectKey } = resolveProjectKey(project);
    const backend = new LocalFilesystemBackend(remote);
    expect(await backend.has(remoteManifestPath(projectKey))).toBe(false);
  });

  it('does not write a local manifest', async () => {
    await syncCommand({ target: remote, cwd: project, skipSecretsCheck: true, dryRun: true });

    const { projectKey } = resolveProjectKey(project);
    await expect(access(localManifestPath(projectKey))).rejects.toThrow();
  });

  it('does not change existing remote content when a modified file would be re-uploaded', async () => {
    // Real sync first, so there is something to diff against.
    await syncCommand({ target: remote, cwd: project, skipSecretsCheck: true });

    const { projectKey } = resolveProjectKey(project);
    const backend = new LocalFilesystemBackend(remote);
    const before = await backend.read(remoteManifestPath(projectKey));

    await writeFile(join(localSessionsDir(project), 'a.jsonl'), '{"cwd":"/home/alice/app","extra":true}\n');
    await syncCommand({ target: remote, cwd: project, skipSecretsCheck: true, dryRun: true });

    const after = await backend.read(remoteManifestPath(projectKey));
    expect(after.equals(before)).toBe(true);
  });
});
