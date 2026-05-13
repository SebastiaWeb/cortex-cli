import { describe, it, expect } from 'vitest';
import { parseSkillMeta } from '../../src/converters/shared.js';

describe('parseSkillMeta', () => {
  it('extracts name and description from frontmatter', () => {
    const content = `---
name: my-skill
description: Does something useful
---

# Instructions
Do the thing.`;
    const meta = parseSkillMeta(content, 'fallback');
    expect(meta.name).toBe('my-skill');
    expect(meta.description).toBe('Does something useful');
    expect(meta.body).toBe(content);
  });

  it('falls back to filename when no frontmatter', () => {
    const meta = parseSkillMeta('# Just a heading\nsome content', 'my-file');
    expect(meta.name).toBe('my-file');
    expect(meta.description).toBeUndefined();
  });

  it('falls back to filename when frontmatter has no name', () => {
    const content = `---
description: Something
---
body`;
    const meta = parseSkillMeta(content, 'fallback-name');
    expect(meta.name).toBe('fallback-name');
  });

  it('handles missing description gracefully', () => {
    const content = `---
name: only-name
---
body`;
    const meta = parseSkillMeta(content, 'fallback');
    expect(meta.name).toBe('only-name');
    expect(meta.description).toBeUndefined();
  });
});
