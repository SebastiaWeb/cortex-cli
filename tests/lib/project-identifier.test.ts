import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProjectKey } from '../../src/lib/project-identifier.js';

describe('resolveProjectKey', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'cortex-projid-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('derives a filesystem-safe key from a cortex.json projectId override', async () => {
    await writeFile(join(tmp, 'cortex.json'), JSON.stringify({ projectId: 'github.com/org/repo' }));
    const result = resolveProjectKey(tmp);
    expect(result.projectId).toBe('github.com/org/repo');
    expect(result.projectKey).toBe('github-com-org-repo');
  });

  it('throws a clear error when no git remote, commit, or cortex.json is found', () => {
    expect(() => resolveProjectKey(tmp)).toThrow(/cortex\.json/i);
  });
});
