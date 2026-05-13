import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFilesystemBackend } from '../../src/storage/local.js';

describe('LocalFilesystemBackend', () => {
  let root: string;
  let backend: LocalFilesystemBackend;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cortex-storage-'));
    backend = new LocalFilesystemBackend(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('write then read returns the same bytes', async () => {
    await backend.write('foo/bar.bin', Buffer.from('hello'));
    const out = await backend.read('foo/bar.bin');
    expect(out.toString()).toBe('hello');
  });

  it('has() reports presence correctly', async () => {
    expect(await backend.has('missing')).toBe(false);
    await backend.write('exists', Buffer.from('x'));
    expect(await backend.has('exists')).toBe(true);
  });

  it('list returns forward-slash relative paths', async () => {
    await backend.write('a.txt', Buffer.from('1'));
    await backend.write('nested/dir/b.txt', Buffer.from('2'));
    const files = await backend.list();
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(['a.txt', 'nested/dir/b.txt']);
  });

  it('remove deletes a file; idempotent on missing files', async () => {
    await backend.write('temp', Buffer.from('x'));
    await backend.remove('temp');
    expect(await backend.has('temp')).toBe(false);
    await expect(backend.remove('temp')).resolves.toBeUndefined();
  });

  it('list on empty root returns []', async () => {
    const fresh = new LocalFilesystemBackend(join(root, 'never-created'));
    expect(await fresh.list()).toEqual([]);
  });

  describe('path traversal protection', () => {
    it('read() throws on ../escape', async () => {
      await expect(backend.read('../etc/passwd')).rejects.toThrow('Path traversal');
    });

    it('write() throws on ../escape', async () => {
      await expect(backend.write('../evil.txt', Buffer.from('x'))).rejects.toThrow('Path traversal');
    });

    it('has() throws on ../escape', async () => {
      await expect(backend.has('../../outside')).rejects.toThrow('Path traversal');
    });

    it('remove() throws on ../escape', async () => {
      await expect(backend.remove('../outside')).rejects.toThrow('Path traversal');
    });

    it('allows deeply nested paths within root', async () => {
      await expect(
        backend.write('a/b/c/d/file.bin', Buffer.from('ok')),
      ).resolves.toBeUndefined();
    });
  });
});
