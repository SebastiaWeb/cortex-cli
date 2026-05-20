import { describe, it, expect } from 'vitest';
import { hasConflict, mergeContent, buildDiffLines } from '../../src/lib/conflict.js';

describe('conflict', () => {
  it('hasConflict returns false when files are identical', () => {
    expect(hasConflict('# TDD\nWrite tests first.', '# TDD\nWrite tests first.')).toBe(false);
  });

  it('hasConflict returns true when files differ', () => {
    expect(hasConflict('# TDD', '# TDD\nExtra line.')).toBe(true);
  });

  it('mergeContent returns local when remote adds nothing new', () => {
    const local = '# TDD\nWrite tests first.';
    expect(mergeContent(local, local)).toBe(local);
  });

  it('mergeContent appends remote-only lines to local', () => {
    const local = '# TDD\nWrite tests first.';
    const remote = '# TDD\nWrite tests first.\nPrefer unit tests.';
    const result = mergeContent(local, remote);
    expect(result).toContain('Write tests first.');
    expect(result).toContain('Prefer unit tests.');
  });

  it('buildDiffLines tags same/local/remote lines correctly', () => {
    const diff = buildDiffLines('shared\nlocal-only', 'shared\nremote-only');
    const shared = diff.filter(d => d.type === 'same');
    const localOnly = diff.filter(d => d.type === 'local');
    const remoteOnly = diff.filter(d => d.type === 'remote');
    expect(shared.some(d => d.line === 'shared')).toBe(true);
    expect(localOnly.some(d => d.line === 'local-only')).toBe(true);
    expect(remoteOnly.some(d => d.line === 'remote-only')).toBe(true);
  });
});
