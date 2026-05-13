import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Always do the thing.' }],
      }),
    };
  },
}));

const { convertToCursor } = await import('../../src/converters/to-cursor.js');
const { parseSkillMeta } = await import('../../src/converters/shared.js');

describe('convertToCursor', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cortex-cursor-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('creates .cursorrules with converted content', async () => {
    const skill = parseSkillMeta('---\nname: my-skill\n---\n# Do stuff', 'my-skill');
    const outPath = await convertToCursor(skill, 'sk-ant-fake', dir);
    expect(outPath).toBe(join(dir, '.cursorrules'));
    const content = await readFile(outPath, 'utf-8');
    expect(content).toContain('Always do the thing.');
    expect(content).toContain('## end my-skill');
  });

  it('appends to existing .cursorrules', async () => {
    await writeFile(join(dir, '.cursorrules'), '# Existing rules\nsome rule\n');
    const skill = parseSkillMeta('---\nname: new-skill\n---\nbody', 'new-skill');
    // Override mock for new-skill
    vi.mocked(
      (await import('@anthropic-ai/sdk')).default.prototype.messages?.create ??
        (() => {}),
    );
    const outPath = await convertToCursor(skill, 'sk-ant-fake', dir);
    const content = await readFile(outPath, 'utf-8');
    expect(content).toContain('# Existing rules');
    expect(content).toContain('Always do the thing.'); // from mock
  });

  it('replaces existing section for same skill (no duplicates)', async () => {
    const skill = parseSkillMeta('---\nname: my-skill\n---\nbody', 'my-skill');

    // First write
    await convertToCursor(skill, 'sk-ant-fake', dir);

    // Second write — same skill name
    await convertToCursor(skill, 'sk-ant-fake', dir);

    const content = await readFile(join(dir, '.cursorrules'), 'utf-8');
    // Section end marker should appear exactly once
    const endCount = (content.match(/## end my-skill/g) ?? []).length;
    expect(endCount).toBe(1);
  });
});
