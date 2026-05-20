import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readProjectConfig, writeProjectConfig } from '../../src/lib/project-config.js';

describe('project-config', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'cortex-proj-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true });
  });

  it('returns empty object when cortex.json is missing', async () => {
    const result = await readProjectConfig(tmp);
    expect(result).toEqual({});
  });

  it('reads repo from cortex.json', async () => {
    await writeFile(join(tmp, 'cortex.json'), JSON.stringify({ repo: 'https://github.com/user/repo' }));
    const result = await readProjectConfig(tmp);
    expect(result.repo).toBe('https://github.com/user/repo');
  });

  it('writes cortex.json with repo field', async () => {
    await writeProjectConfig({ repo: 'https://github.com/user/repo' }, tmp);
    const raw = JSON.parse(await readFile(join(tmp, 'cortex.json'), 'utf-8'));
    expect(raw.repo).toBe('https://github.com/user/repo');
  });

  it('writeProjectConfig merges into existing cortex.json', async () => {
    await writeFile(join(tmp, 'cortex.json'), JSON.stringify({ projectId: 'my-id', repo: 'old' }));
    await writeProjectConfig({ repo: 'https://github.com/user/new-repo' }, tmp);
    const raw = JSON.parse(await readFile(join(tmp, 'cortex.json'), 'utf-8'));
    expect(raw.projectId).toBe('my-id');
    expect(raw.repo).toBe('https://github.com/user/new-repo');
  });
});
