import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decrypt, deriveKey } from '../../src/lib/crypto.js';
import { decompress } from '../../src/lib/compress.js';
import { LocalFilesystemBackend } from '../../src/storage/local.js';
import { remoteFilePath } from '../../src/lib/project-storage-paths.js';
import { resolveProjectKey } from '../../src/lib/project-identifier.js';
import type { syncCommand as SyncCommandFn } from '../../src/commands/sync.js';

// A secret living in CLAUDE.md or a skill must never reach personal storage in
// plaintext when the user opts into --redact — even though the blob itself is
// already AES-256-GCM encrypted, redaction is about not persisting the secret
// at all (defense in depth: a leaked passphrase shouldn't also leak the key).
describe('cortex sync --redact', () => {
  let claudeHome: string;
  let project: string;
  let remote: string;
  let syncCommand: typeof SyncCommandFn;
  const email = 'dev@example.com';
  const passphrase = 'correct-horse-battery-staple';
  const derived = deriveKey(passphrase, email);
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
    await writeFile(join(project, 'cortex.json'), JSON.stringify({ projectId: 'redact-test' }));
    await mkdir(join(project, '.claude'), { recursive: true });
    await writeFile(join(project, '.claude', 'CLAUDE.md'), `# notes\naws_key=${secret}\n`);

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

  it('uploads a redacted placeholder instead of the real secret', async () => {
    await syncCommand({ target: remote, cwd: project, redact: true });

    const { projectKey } = resolveProjectKey(project);
    const backend = new LocalFilesystemBackend(remote);
    const blob = await backend.read(remoteFilePath(projectKey, 'CLAUDE.md'));
    const uploaded = decompress(decrypt(blob, derived)).toString('utf-8');

    expect(uploaded).not.toContain(secret);
    expect(uploaded).toContain('[REDACTED:AWS Access Key]');
  });

  it('without --redact, the real secret is uploaded (still encrypted, but present)', async () => {
    await syncCommand({ target: remote, cwd: project, skipSecretsCheck: true });

    const { projectKey } = resolveProjectKey(project);
    const backend = new LocalFilesystemBackend(remote);
    const blob = await backend.read(remoteFilePath(projectKey, 'CLAUDE.md'));
    const uploaded = decompress(decrypt(blob, derived)).toString('utf-8');

    expect(uploaded).toContain(secret);
  });
});
