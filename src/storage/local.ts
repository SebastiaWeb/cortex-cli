import { access, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { IStorageBackend, RemoteFile } from './types.js';

export class LocalFilesystemBackend implements IStorageBackend {
  readonly name = 'local';

  constructor(private readonly root: string) {}

  async list(): Promise<RemoteFile[]> {
    const out: RemoteFile[] = [];
    await this.walk(this.root, out);
    return out;
  }

  async has(path: string): Promise<boolean> {
    try {
      await access(join(this.root, path));
      return true;
    } catch {
      return false;
    }
  }

  async read(path: string): Promise<Buffer> {
    return readFile(join(this.root, path));
  }

  async write(path: string, content: Buffer): Promise<void> {
    const dest = join(this.root, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content);
  }

  async remove(path: string): Promise<void> {
    try {
      await unlink(join(this.root, path));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
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
        const path = relative(this.root, full).split(sep).join('/');
        out.push({ path, size: s.size, mtime: s.mtimeMs });
      }
    }
  }
}
