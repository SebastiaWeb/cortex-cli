import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock the Anthropic SDK before importing converters
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '---\nname: test-skill\ntype: skill\n---\nConverted content' }],
      }),
    };
  },
}));

const { convertToAntigravity } = await import('../../src/converters/to-antigravity.js');
const { parseSkillMeta } = await import('../../src/converters/shared.js');

describe('convertToAntigravity', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cortex-ag-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('writes output to .agent/skills/<name>/SKILL.md', async () => {
    const skill = parseSkillMeta('---\nname: my-skill\n---\n# Do stuff', 'my-skill');
    const outPath = await convertToAntigravity(skill, 'sk-ant-fake', dir);
    expect(outPath).toBe(join(dir, '.agent', 'skills', 'my-skill', 'SKILL.md'));
    const content = await readFile(outPath, 'utf-8');
    expect(content).toContain('Converted content');
  });

  it('returns path without rewriting when content is identical', async () => {
    const skill = parseSkillMeta('---\nname: stable\n---\nbody', 'stable');
    const path1 = await convertToAntigravity(skill, 'sk-ant-fake', dir);
    const mtime1 = (await import('node:fs')).statSync(path1).mtimeMs;

    // Second call with same mock response — file should not be rewritten
    await new Promise((r) => setTimeout(r, 10));
    const path2 = await convertToAntigravity(skill, 'sk-ant-fake', dir);
    const mtime2 = (await import('node:fs')).statSync(path2).mtimeMs;

    expect(path1).toBe(path2);
    expect(mtime2).toBe(mtime1); // unchanged
  });
});
