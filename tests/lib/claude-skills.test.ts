import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readSkillsFromDir,
  writeSkillToDir,
  readFileFromPath,
  writeFileToPath,
} from '../../src/lib/claude-skills.js';

describe('claude-skills', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'cortex-skills-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true });
  });

  it('readSkillsFromDir returns empty map when dir missing', async () => {
    const result = await readSkillsFromDir(join(tmp, 'nonexistent'));
    expect(result.size).toBe(0);
  });

  it('readSkillsFromDir reads .md files only', async () => {
    await writeFile(join(tmp, 'tdd.md'), '# TDD');
    await writeFile(join(tmp, 'debug.md'), '# Debug');
    await writeFile(join(tmp, 'ignore.txt'), 'not a skill');
    const result = await readSkillsFromDir(tmp);
    expect(result.size).toBe(2);
    expect(result.get('tdd.md')).toBe('# TDD');
    expect(result.get('debug.md')).toBe('# Debug');
  });

  it('writeSkillToDir creates directory and writes file', async () => {
    const skillsDir = join(tmp, 'skills');
    await writeSkillToDir(skillsDir, 'new.md', '# New');
    const content = await readFile(join(skillsDir, 'new.md'), 'utf-8');
    expect(content).toBe('# New');
  });

  it('readFileFromPath returns null when file missing', async () => {
    const result = await readFileFromPath(join(tmp, 'missing.md'));
    expect(result).toBeNull();
  });

  it('readFileFromPath returns content when file exists', async () => {
    await writeFile(join(tmp, 'claude.md'), '# Project');
    const result = await readFileFromPath(join(tmp, 'claude.md'));
    expect(result).toBe('# Project');
  });
});
