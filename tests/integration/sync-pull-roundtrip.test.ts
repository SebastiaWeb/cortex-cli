import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checksumSha256, decrypt, deriveKey, encrypt } from '../../src/lib/crypto.js';
import { diffManifests, emptyManifest, type Manifest } from '../../src/lib/manifest.js';
import { LocalFilesystemBackend } from '../../src/storage/local.js';
import { collectProjectFiles, placeSessionFiles } from '../../src/lib/project-content.js';
import { remoteManifestPath, remoteFilePath } from '../../src/lib/project-storage-paths.js';
import { resolveProjectKey } from '../../src/lib/project-identifier.js';
import { readFileFromPath, writeFileToPath, injectCortexPathBlock } from '../../src/lib/claude-skills.js';
import { localSessionsDir } from '../../src/lib/team-sessions.js';

// End-to-end: simulate machine A syncing a project's files, then machine B
// pulling them — exercising the same primitives sync.ts/pull.ts use, scoped
// per-project (this is the behavior cortex sync/pull now share with cortex team).
describe('cortex sync → cortex pull round-trip (project-scoped)', () => {
  let claudeHomeA: string;
  let claudeHomeB: string;
  let remote: string;
  const derived = deriveKey('correct-horse-battery-staple', 'dev@example.com');

  beforeEach(async () => {
    claudeHomeA = await mkdtemp(join(tmpdir(), 'cortex-homeA-'));
    claudeHomeB = await mkdtemp(join(tmpdir(), 'cortex-homeB-'));
    remote = await mkdtemp(join(tmpdir(), 'cortex-remote-'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(claudeHomeA, { recursive: true, force: true });
    await rm(claudeHomeB, { recursive: true, force: true });
    await rm(remote, { recursive: true, force: true });
  });

  it('carries sessions (remapped), CLAUDE.md, and skills from A to B', async () => {
    const projectA = await mkdtemp(join(tmpdir(), 'cortex-projA-'));
    const projectB = await mkdtemp(join(tmpdir(), 'cortex-projB-'));
    try {
      await writeFile(join(projectA, 'cortex.json'), JSON.stringify({ projectId: 'myapp' }));
      await writeFile(join(projectB, 'cortex.json'), JSON.stringify({ projectId: 'myapp' }));
      const { projectKey } = resolveProjectKey(projectA);
      expect(resolveProjectKey(projectB).projectKey).toBe(projectKey); // same logical project

      // ── Seed machine A's project ──────────────────────────────────────────
      vi.stubEnv('HOME', claudeHomeA);
      await mkdir(localSessionsDir(projectA), { recursive: true });
      await writeFile(
        join(localSessionsDir(projectA), 'session.jsonl'),
        `{"cwd":"${projectA}","type":"system"}\n`,
      );
      await mkdir(join(projectA, '.claude', 'skills'), { recursive: true });
      await writeFile(join(projectA, '.claude', 'CLAUDE.md'), '# hello team');
      await writeFile(join(projectA, '.claude', 'skills', 'tdd.md'), '# tdd skill');
      await writeFile(join(projectA, 'ARCHITECTURE.md'), '# extra doc');

      // ── SYNC from A ──────────────────────────────────────────────────────
      const backend = new LocalFilesystemBackend(remote);
      const contentsA = await collectProjectFiles(projectA);
      // Extra .md docs (findExtraMdFiles) are approved interactively by sync.ts, not collected here.
      contentsA.set('docs/ARCHITECTURE.md', Buffer.from('# extra doc', 'utf-8'));
      expect([...contentsA.keys()].sort()).toEqual([
        'CLAUDE.md', 'docs/ARCHITECTURE.md', 'sessions/session.jsonl', 'skills/tdd.md',
      ]);

      const manifestA: Manifest = { ...emptyManifest('claude-code'), originalPath: projectA };
      for (const [path, content] of contentsA) {
        manifestA.files[path] = { checksum: checksumSha256(content), size: content.length, encryptedSize: 0 };
        await backend.write(remoteFilePath(projectKey, path), encrypt(content, derived));
      }
      await backend.write(
        remoteManifestPath(projectKey),
        encrypt(Buffer.from(JSON.stringify(manifestA), 'utf-8'), derived),
      );

      // ── PULL on B ────────────────────────────────────────────────────────
      vi.stubEnv('HOME', claudeHomeB);
      const remoteManifest = JSON.parse(
        decrypt(await backend.read(remoteManifestPath(projectKey)), derived).toString('utf-8'),
      ) as Manifest;
      const diff = diffManifests(remoteManifest, emptyManifest('claude-code'));
      expect(diff.added.sort()).toEqual([
        'CLAUDE.md', 'docs/ARCHITECTURE.md', 'sessions/session.jsonl', 'skills/tdd.md',
      ]);

      const downloaded = new Map<string, Buffer>();
      for (const path of diff.added) {
        downloaded.set(path, decrypt(await backend.read(remoteFilePath(projectKey, path)), derived));
      }

      const sessionFiles = new Map([['session.jsonl', downloaded.get('sessions/session.jsonl')!]]);
      const written = await placeSessionFiles(projectB, sessionFiles, remoteManifest.originalPath ?? null);
      expect(written.size).toBe(1);

      await writeFileToPath(
        join(projectB, '.claude', 'CLAUDE.md'),
        injectCortexPathBlock(downloaded.get('CLAUDE.md')!.toString('utf-8'), projectB),
      );
      await writeFileToPath(
        join(projectB, '.claude', 'skills', 'tdd.md'),
        downloaded.get('skills/tdd.md')!.toString('utf-8'),
      );
      await writeFileToPath(
        join(projectB, 'ARCHITECTURE.md'), // docs land at the same relative path as the source
        downloaded.get('docs/ARCHITECTURE.md')!.toString('utf-8'),
      );

      // ── Verify ───────────────────────────────────────────────────────────
      const sessionOnB = await readFile(join(localSessionsDir(projectB), 'session.jsonl'), 'utf-8');
      expect(sessionOnB).toContain(projectB);
      expect(sessionOnB).not.toContain(projectA);

      const claudeMdOnB = await readFileFromPath(join(projectB, '.claude', 'CLAUDE.md'));
      expect(claudeMdOnB).toContain('# hello team');
      expect(claudeMdOnB).toContain(projectB); // machine-specific cortex-sync path block re-injected

      const skillOnB = await readFileFromPath(join(projectB, '.claude', 'skills', 'tdd.md'));
      expect(skillOnB).toBe('# tdd skill');

      const docOnB = await readFileFromPath(join(projectB, 'ARCHITECTURE.md'));
      expect(docOnB).toBe('# extra doc');
    } finally {
      await rm(projectA, { recursive: true, force: true });
      await rm(projectB, { recursive: true, force: true });
    }
  });

  it('two different projects on the same personal backend do not collide', async () => {
    const projectFoo = await mkdtemp(join(tmpdir(), 'cortex-foo-'));
    const projectBar = await mkdtemp(join(tmpdir(), 'cortex-bar-'));
    try {
      await writeFile(join(projectFoo, 'cortex.json'), JSON.stringify({ projectId: 'foo' }));
      await writeFile(join(projectBar, 'cortex.json'), JSON.stringify({ projectId: 'bar' }));
      const { projectKey: keyFoo } = resolveProjectKey(projectFoo);
      const { projectKey: keyBar } = resolveProjectKey(projectBar);
      expect(keyFoo).not.toBe(keyBar);

      vi.stubEnv('HOME', claudeHomeA);
      await mkdir(localSessionsDir(projectFoo), { recursive: true });
      await writeFile(join(localSessionsDir(projectFoo), 's.jsonl'), 'foo-session\n');
      await mkdir(localSessionsDir(projectBar), { recursive: true });
      await writeFile(join(localSessionsDir(projectBar), 's.jsonl'), 'bar-session\n');

      const backend = new LocalFilesystemBackend(remote);

      for (const [key, cwd] of [[keyFoo, projectFoo], [keyBar, projectBar]] as const) {
        const contents = await collectProjectFiles(cwd);
        const manifest: Manifest = { ...emptyManifest('claude-code'), originalPath: cwd };
        for (const [path, content] of contents) {
          manifest.files[path] = { checksum: checksumSha256(content), size: content.length, encryptedSize: 0 };
          await backend.write(remoteFilePath(key, path), encrypt(content, derived));
        }
        await backend.write(
          remoteManifestPath(key),
          encrypt(Buffer.from(JSON.stringify(manifest), 'utf-8'), derived),
        );
      }

      // Both projects' data survive independently — syncing one never touches the other's namespace.
      expect(await backend.has(remoteFilePath(keyFoo, 'sessions/s.jsonl'))).toBe(true);
      expect(await backend.has(remoteFilePath(keyBar, 'sessions/s.jsonl'))).toBe(true);
      const fooContent = decrypt(await backend.read(remoteFilePath(keyFoo, 'sessions/s.jsonl')), derived);
      const barContent = decrypt(await backend.read(remoteFilePath(keyBar, 'sessions/s.jsonl')), derived);
      expect(fooContent.toString('utf-8')).toBe('foo-session\n');
      expect(barContent.toString('utf-8')).toBe('bar-session\n');
    } finally {
      await rm(projectFoo, { recursive: true, force: true });
      await rm(projectBar, { recursive: true, force: true });
    }
  });
});
