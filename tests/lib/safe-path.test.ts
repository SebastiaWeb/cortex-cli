import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { safeJoin } from '../../src/lib/safe-path.js';

describe('safeJoin', () => {
  it('joins a normal relative path inside base', () => {
    expect(safeJoin('/home/user/project', 'docs/ARCHITECTURE.md')).toBe(
      join('/home/user/project', 'docs/ARCHITECTURE.md'),
    );
  });

  it('throws when relPath escapes base via ../', () => {
    expect(() => safeJoin('/home/user/project', '../../../../.bashrc')).toThrow(/traversal/i);
  });

  it('throws when relPath escapes base via a nested docs/ prefix stripped by the caller', () => {
    // Reproduces the exact manifest-controlled path from the verified PoC:
    // a remote manifest entry "docs/../../../../.bashrc" with the "docs/" prefix
    // already stripped by the caller before reaching safeJoin.
    expect(() => safeJoin('/home/user/project', '../../../../.bashrc')).toThrow(/traversal/i);
  });

  it('throws when the resolved path equals base exactly (no filename)', () => {
    expect(() => safeJoin('/home/user/project', '..')).toThrow(/traversal/i);
  });

  it('allows a subdirectory path that stays inside base', () => {
    expect(safeJoin('/home/user/project', 'a/b/c.md')).toBe(join('/home/user/project', 'a/b/c.md'));
  });
});
