import { access, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { IStorageBackend, RemoteFile } from './types.js';

export class LocalFilesystemBackend implements IStorageBackend {
  readonly name = 'local';
  private readonly resolvedRoot: string;

  constructor(private readonly root: string) {
    this.resolvedRoot = resolve(root);
  }

  /** Resolve and validate that `path` stays within root — throws on traversal. */
  private safePath(path: string): string {
    const resolved = resolve(join(this.resolvedRoot, path));
    if (resolved !== this.resolvedRoot && !resolved.startsWith(this.resolvedRoot + sep)) {
      throw new Error(`Path traversal attempt blocked: ${path}`);
    }
    return resolved;
  }

  async list(): Promise<RemoteFile[]> {
    const out: RemoteFile[] = [];
    await this.walk(this.resolvedRoot, out);
    return out;
  }

  async has(path: string): Promise<boolean> {
    const safe = this.safePath(path); // throws on traversal — must not be caught below
    try {
      await access(safe);
      return true;
    } catch {
      return false;
    }
  }

  async read(path: string): Promise<Buffer> {
    return readFile(this.safePath(path));
  }

  async write(path: string, content: Buffer): Promise<void> {
    const dest = this.safePath(path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content);
  }

  async remove(path: string): Promise<void> {
    try {
      await unlink(this.safePath(path));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }

  async writeMany(files: Array<{ path: string; content: Buffer }>): Promise<void> {
    for (const f of files) await this.write(f.path, f.content);
  }

  async removeMany(paths: string[]): Promise<void> {
    for (const path of paths) await this.remove(path);
  }

  private async walk(dir: string, out: RemoteFile[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await this.walk(full, out);
      } else if (e.isFile()) {
        const s = await stat(full);
        const path = relative(this.resolvedRoot, full).split(sep).join('/');
        out.push({ path, size: s.size, mtime: s.mtimeMs });
      }
    }
  }
}
