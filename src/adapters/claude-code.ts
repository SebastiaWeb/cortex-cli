import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { resolveToolPath } from './paths.js';
import type { FileEntry, IToolAdapter, SupportedTool } from './types.js';

export class ClaudeCodeAdapter implements IToolAdapter {
  readonly tool: SupportedTool = 'claude-code';
  private readonly root: string;

  constructor(root?: string) {
    this.root = root ?? resolveToolPath('claude-code');
  }

  async *getFiles(): AsyncIterable<FileEntry> {
    yield* this.walk(this.root);
  }

  async putFiles(files: AsyncIterable<FileEntry>): Promise<void> {
    const resolvedRoot = resolve(this.root);
    for await (const f of files) {
      const dest = resolve(join(resolvedRoot, f.relativePath));
      // Block path traversal from a compromised remote manifest
      if (dest !== resolvedRoot && !dest.startsWith(resolvedRoot + sep)) {
        throw new Error(`Path traversal attempt blocked: ${f.relativePath}`);
      }
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, f.content);
    }
  }

  // Encoded names are lossy (see Fase 0 findings) — callers must resolve the
  // canonical path from the JSONL `cwd` field, not from this name.
  getProjectPath(encodedProjectName: string): string {
    return join(this.root, 'projects', encodedProjectName);
  }

  private async *walk(dir: string): AsyncIterable<FileEntry> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        yield* this.walk(full);
      } else if (e.isFile()) {
        const content = await readFile(full);
        const relativePath = relative(this.root, full).split(sep).join('/');
        const s = await stat(full);
        yield { relativePath, content, mode: s.mode };
      }
    }
  }
}
