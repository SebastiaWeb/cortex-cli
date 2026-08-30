import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checksumSha256, deriveKey, encrypt } from '../../src/lib/crypto.js';
import { compress } from '../../src/lib/compress.js';
import { emptyManifest, type Manifest } from '../../src/lib/manifest.js';
import { LocalFilesystemBackend } from '../../src/storage/local.js';
import { remoteManifestPath, remoteFilePath } from '../../src/lib/project-storage-paths.js';
import { resolveProjectKey } from '../../src/lib/project-identifier.js';
import type { pullCommand as PullCommandFn } from '../../src/commands/pull.js';

// Reproduces, end-to-end through the real pullCommand, the manifest-controlled
// path traversal verified against the pre-fix code:
//   remote manifest entry "docs/../../../../.bashrc"  →  join(cwd, relPath) escapes cwd
// A remote manifest is untrusted: it comes from your own storage backend, which
// an attacker reaches via a leaked token, or (in the team scenario) the shared
// team passphrase. This must never let cortex pull write outside the project.
describe('cortex pull rejects path traversal from a malicious remote manifest', () => {
  let claudeHome: string;
  let project: string;
  let remote: string;
  let pullCommand: typeof PullCommandFn;
  const email = 'dev@example.com';
  const passphrase = 'correct-horse-battery-staple';
  const derived = deriveKey(passphrase, email);

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
    await writeFile(join(project, 'cortex.json'), JSON.stringify({ projectId: 'traversal-test' }));

    // config.ts computes CORTEX_DIR from homedir() at module-load time, so
    // vi.stubEnv('HOME', ...) only takes effect on a module instance imported
    // AFTER the stub is set — hence resetModules + a fresh dynamic import here.
    vi.resetModules();
    ({ pullCommand } = await import('../../src/commands/pull.js'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(claudeHome, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
    await rm(remote, { recursive: true, force: true });
  });

  async function seedMaliciousManifest(entryPath: string): Promise<void> {
    const { projectKey } = resolveProjectKey(project);
    const backend = new LocalFilesystemBackend(remote);
    const payload = Buffer.from('pwned-by-manifest\n');
    const manifest: Manifest = { ...emptyManifest('claude-code'), originalPath: project };
    manifest.files[entryPath] = { checksum: checksumSha256(payload), size: payload.length, encryptedSize: 0 };
    await backend.write(remoteFilePath(projectKey, entryPath), encrypt(compress(payload), derived));
    await backend.write(remoteManifestPath(projectKey), encrypt(compress(Buffer.from(JSON.stringify(manifest))), derived));
  }

  it('rejects a malicious docs/ entry instead of writing outside the project', async () => {
    await seedMaliciousManifest('docs/../../../../.bashrc');

    await expect(pullCommand({ target: remote, cwd: project, nonInteractive: true }))
      .rejects.toThrow(/traversal/i);

    await expect(access(join(claudeHome, '.bashrc'))).rejects.toThrow();
  });

  it('rejects a malicious skills/ entry instead of writing outside the project', async () => {
    await seedMaliciousManifest('skills/../../../../.ssh/authorized_keys');

    await expect(pullCommand({ target: remote, cwd: project, nonInteractive: true }))
      .rejects.toThrow(/traversal/i);

    await expect(access(join(claudeHome, '.ssh', 'authorized_keys'))).rejects.toThrow();
  });
});
