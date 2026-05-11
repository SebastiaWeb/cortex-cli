import { describe, it, expect } from 'vitest';
import { diffManifests, emptyManifest, type Manifest } from '../../src/lib/manifest.js';

function entry(checksum: string): Manifest['files'][string] {
  return { checksum, size: 1, encryptedSize: 1 };
}

describe('manifest', () => {
  it('emptyManifest has zero files and version 1', () => {
    const m = emptyManifest('claude-code');
    expect(m.version).toBe(1);
    expect(Object.keys(m.files)).toHaveLength(0);
  });

  it('diff classifies added/modified/removed/unchanged', () => {
    const local = emptyManifest('claude-code');
    const remote = emptyManifest('claude-code');
    local.files['a.txt'] = entry('aaa');     // added (not in remote)
    local.files['b.txt'] = entry('bbb-new'); // modified
    local.files['c.txt'] = entry('ccc');     // unchanged
    remote.files['b.txt'] = entry('bbb-old');
    remote.files['c.txt'] = entry('ccc');
    remote.files['d.txt'] = entry('ddd');    // removed (in remote, not local)

    const diff = diffManifests(local, remote);
    expect(diff.added).toEqual(['a.txt']);
    expect(diff.modified).toEqual(['b.txt']);
    expect(diff.unchanged).toEqual(['c.txt']);
    expect(diff.removed).toEqual(['d.txt']);
  });
});
