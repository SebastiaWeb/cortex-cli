import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, mkdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSafeRepoUrl, cloneTeamRepo, pullTeamRepo, commitAndPush, hasLocalClone } from '../../src/lib/team-repo.js';

describe('assertSafeRepoUrl', () => {
  it('accepts a normal https GitHub URL', () => {
    expect(() => assertSafeRepoUrl('https://github.com/org/repo')).not.toThrow();
  });

  it('rejects a URL starting with -- (git argument injection)', () => {
    expect(() => assertSafeRepoUrl('--upload-pack=touch /tmp/pwned;true'))
      .toThrow(/repo url/i);
  });

  it('rejects a non-https URL (e.g. ext:: or ssh:)', () => {
    expect(() => assertSafeRepoUrl('ext::sh -c touch /tmp/pwned')).toThrow(/repo url/i);
  });

  it('rejects an empty string', () => {
    expect(() => assertSafeRepoUrl('')).toThrow(/repo url/i);
  });
});

describe('team-repo', () => {
  it('hasLocalClone returns false when dir missing', async () => {
    const result = await hasLocalClone('/nonexistent/path/team');
    expect(result).toBe(false);
  });

  it('hasLocalClone returns false when dir exists but has no .git', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cortex-test-'));
    try {
      const result = await hasLocalClone(tmp);
      expect(result).toBe(false);
    } finally {
      await rm(tmp, { recursive: true });
    }
  });

  it('hasLocalClone returns true when .git dir exists', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cortex-test-'));
    try {
      await mkdir(join(tmp, '.git'));
      const result = await hasLocalClone(tmp);
      expect(result).toBe(true);
    } finally {
      await rm(tmp, { recursive: true });
    }
  });

  describe('cloneTeamRepo security', () => {
    let bare: string;
    let dest: string;

    beforeEach(async () => {
      bare = await mkdtemp(join(tmpdir(), 'cortex-bare-'));
      dest = await mkdtemp(join(tmpdir(), 'cortex-dest-'));
    });

    afterEach(async () => {
      await rm(bare, { recursive: true, force: true });
      await rm(dest, { recursive: true, force: true });
    });

    it('PAT does not appear in .git/config after cloneTeamRepo', async () => {
      // Create a local bare repo (no auth needed for file://, which is fine —
      // we're testing that the token string is never written to .git/config,
      // regardless of whether git actually used it to authenticate).
      const init = spawnSync('git', ['init', '--bare', bare], { stdio: 'pipe' });
      if (init.status !== 0) return; // skip if git unavailable in this env

      const fakeToken = 'ghp_super_secret_token_xyz_12345';

      // cloneTeamRepo must clone into dest (not the default TEAM_DIR)
      await cloneTeamRepo(`file://${bare}`, fakeToken, dest);

      const gitConfig = await readFile(join(dest, '.git', 'config'), 'utf-8');
      expect(gitConfig).not.toContain(fakeToken);
      // The clean URL (without token) must be present
      expect(gitConfig).toContain(bare);
    });

    it('cloneTeamRepo rejects a repoUrl crafted as a git argument-injection payload', async () => {
      // Reproduces the exploit verified against the pre-fix code:
      //   git clone "--upload-pack=touch <marker>;true" file://<bare> <dest>
      // git parses --upload-pack as an option (not a positional URL) and runs
      // the attacker command before failing the clone. This must be rejected
      // before spawnSync is ever called — not merely fail safely afterward.
      const init = spawnSync('git', ['init', '--bare', bare], { stdio: 'pipe' });
      if (init.status !== 0) return; // skip if git unavailable in this env

      const marker = join(dest, 'pwned-marker');
      const payload = `--upload-pack=touch ${marker};true`;

      await expect(cloneTeamRepo(payload, 'fake-token', dest)).rejects.toThrow(/repo url/i);

      await expect(access(marker)).rejects.toThrow(); // the injected command must NOT have run
    });

    it('pullTeamRepo rejects a malicious repoUrl before spawning git', () => {
      const marker = join(dest, 'pwned-pull-marker');
      const payload = `--upload-pack=touch ${marker};true`;
      expect(() => pullTeamRepo(payload, 'fake-token', dest)).toThrow(/repo url/i);
    });

    it('commitAndPush rejects a malicious repoUrl before spawning git', () => {
      const marker = join(dest, 'pwned-push-marker');
      const payload = `--upload-pack=touch ${marker};true`;
      expect(() => commitAndPush(payload, 'fake-token', 'msg', dest)).toThrow(/repo url/i);
    });
  });
});
