import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readSkillsFromDir,
  writeSkillToDir,
  readFileFromPath,
  writeFileToPath,
  injectCortexPathBlock,
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

const CORTEX_START = '<!-- cortex-sync:start -->';
const CORTEX_END = '<!-- cortex-sync:end -->';

describe('injectCortexPathBlock', () => {
  it('prepends block when no existing block', () => {
    const result = injectCortexPathBlock('# Team docs\n\nSome content.', '/home/alice/project');
    expect(result.indexOf(CORTEX_START)).toBe(0);
    expect(result).toContain('`/home/alice/project`');
    expect(result).toContain(CORTEX_END);
    expect(result).toContain('# Team docs');
  });

  it('replaces existing block in-place, preserving surrounding content', () => {
    const old = [
      CORTEX_START,
      '> **[cortex-sync]** Project root on this machine: `/home/old/path`',
      '> Sessions shared via cortex-sync may reference paths from other machines. Always resolve file operations against the project root above.',
      CORTEX_END,
      '',
      '# Team docs',
    ].join('\n');

    const result = injectCortexPathBlock(old, '/home/new/path');
    expect(result).toContain('`/home/new/path`');
    expect(result).not.toContain('`/home/old/path`');
    expect(result).toContain('# Team docs');
    expect(result.split(CORTEX_START).length).toBe(2);
  });

  it('works with empty content (no team CLAUDE.md)', () => {
    const result = injectCortexPathBlock('', '/home/alice/project');
    expect(result).toContain(CORTEX_START);
    expect(result).toContain('`/home/alice/project`');
    expect(result).toContain(CORTEX_END);
  });

  it('works with Windows paths', () => {
    const result = injectCortexPathBlock('# Docs', 'C:\\Users\\alice\\project');
    expect(result).toContain('`C:\\Users\\alice\\project`');
  });

  it('block is always at the very start of the output', () => {
    const result = injectCortexPathBlock('# Existing content', '/home/alice/project');
    expect(result.startsWith(CORTEX_START)).toBe(true);
  });
});
