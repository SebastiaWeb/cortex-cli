import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFilesystemBackend } from '../../src/storage/local.js';
import { remoteManifestPath } from '../../src/lib/project-storage-paths.js';
import { resolveProjectKey } from '../../src/lib/project-identifier.js';
import type { syncCommand as SyncCommandFn } from '../../src/commands/sync.js';

// --strict is the harder line than the default warn-and-continue: refuse to
// sync at all when a secret is found, instead of just printing a warning.
describe('cortex sync --strict', () => {
  let claudeHome: string;
  let project: string;
  let remote: string;
  let syncCommand: typeof SyncCommandFn;
  const email = 'dev@example.com';
  const passphrase = 'correct-horse-battery-staple';
  const secret = 'AKIAIOSFODNN7EXAMPLE';

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
    await writeFile(join(project, 'cortex.json'), JSON.stringify({ projectId: 'strict-test' }));
    await mkdir(join(project, '.claude'), { recursive: true });

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

  it('refuses to sync when a secret is found', async () => {
    await writeFile(join(project, '.claude', 'CLAUDE.md'), `# notes\naws_key=${secret}\n`);

    await expect(syncCommand({ target: remote, cwd: project, strict: true }))
      .rejects.toThrow(/secret/i);

    const { projectKey } = resolveProjectKey(project);
    const backend = new LocalFilesystemBackend(remote);
    expect(await backend.has(remoteManifestPath(projectKey))).toBe(false);
  });

  it('does not block when combined with --redact, since nothing unsafe is left to find', async () => {
    await writeFile(join(project, '.claude', 'CLAUDE.md'), `# notes\naws_key=${secret}\n`);

    await expect(syncCommand({ target: remote, cwd: project, strict: true, redact: true }))
      .resolves.toBeUndefined();
  });

  it('does not block a project with no secrets', async () => {
    await writeFile(join(project, '.claude', 'CLAUDE.md'), '# just some notes\n');

    await expect(syncCommand({ target: remote, cwd: project, strict: true }))
      .resolves.toBeUndefined();
  });
});
