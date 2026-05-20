import { describe, it, expect } from 'vitest';
import { parseInstalledPlugins } from '../../src/lib/claude-plugins.js';

describe('claude-plugins', () => {
  it('returns empty array for empty plugins object', () => {
    const result = parseInstalledPlugins({ version: 2, plugins: {} });
    expect(result).toEqual([]);
  });

  it('returns plugin identifiers from installed_plugins.json shape', () => {
    const data = {
      version: 2,
      plugins: {
        'superpowers@claude-plugins-official': [{ scope: 'user' }],
        'context7@claude-plugins-official': [{ scope: 'user' }],
      },
    };
    const result = parseInstalledPlugins(data);
    expect(result).toContain('superpowers@claude-plugins-official');
    expect(result).toContain('context7@claude-plugins-official');
    expect(result).toHaveLength(2);
  });
});
