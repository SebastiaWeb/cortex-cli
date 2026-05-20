import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authUrl, hasLocalClone } from '../../src/lib/team-repo.js';

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
});
