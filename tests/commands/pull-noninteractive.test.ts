import { describe, expect, it } from 'vitest';
import { resolveLocalPath } from '../../src/commands/pull.js';

describe('resolveLocalPath', () => {
  it('returns null in nonInteractive mode when project is unknown', async () => {
    const result = await resolveLocalPath(
      'proj-abc123',
      '/Users/alice/work/myapp',
      {},
      undefined,
      true,
    );
    expect(result).toBeNull();
  });

  it('uses projectMappings by projectId', async () => {
    const result = await resolveLocalPath(
      'proj-abc123',
      '/Users/alice/work/myapp',
      {},
      { 'proj-abc123': '/home/alice/myapp' },
      true,
    );
    expect(result).toBe('/home/alice/myapp');
  });

  it('uses projectMappings by originalPath when projectId is null', async () => {
    const result = await resolveLocalPath(
      null,
      '/Users/alice/work/myapp',
      {},
      { '/Users/alice/work/myapp': '/home/alice/myapp' },
      true,
    );
    expect(result).toBe('/home/alice/myapp');
  });

  it('uses stored mappings when no projectMappings provided', async () => {
    const result = await resolveLocalPath(
      'proj-abc123',
      '/Users/alice/work/myapp',
      { 'proj-abc123': '/home/alice/myapp' },
      undefined,
      true,
    );
    expect(result).toBe('/home/alice/myapp');
  });
});
