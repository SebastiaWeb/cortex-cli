import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authUrl, cloneTeamRepo, hasLocalClone } from '../../src/lib/team-repo.js';

describe('team-repo', () => {
  it('authUrl embeds token into https URL', () => {
    const result = authUrl('https://github.com/user/repo', 'ghp_TOKEN');
    expect(result).toBe('https://ghp_TOKEN@github.com/user/repo');
  });

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
  });
});
