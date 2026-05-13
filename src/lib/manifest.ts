import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SupportedTool } from '../adapters/types.js';

export interface ManifestEntry {
  checksum: string;       // SHA-256 hex of plaintext
  size: number;           // plaintext size in bytes
  encryptedSize: number;  // size after AES-GCM (0 until uploaded)
}

export interface ProjectEntry {
  projectId: string | null;  // null when no git and no cortex.json
  originalPath: string;      // cwd extracted from JSONL — ground truth path on the source machine
}

export interface Manifest {
  version: 1;
  generatedAt: string;
  tool: SupportedTool;
  files: Record<string, ManifestEntry>;
  projects?: Record<string, ProjectEntry>;  // encodedDir → project metadata
}

export interface ManifestDiff {
  added: string[];
  modified: string[];
  removed: string[];
  unchanged: string[];
}

export function emptyManifest(tool: SupportedTool): Manifest {
  return { version: 1, generatedAt: new Date().toISOString(), tool, files: {} };
}

export function diffManifests(local: Manifest, remote: Manifest): ManifestDiff {
  const diff: ManifestDiff = { added: [], modified: [], removed: [], unchanged: [] };
  const remotePaths = new Set(Object.keys(remote.files));
  for (const [path, entry] of Object.entries(local.files)) {
    const remoteEntry = remote.files[path];
    if (!remoteEntry) diff.added.push(path);
    else if (remoteEntry.checksum !== entry.checksum) diff.modified.push(path);
    else diff.unchanged.push(path);
    remotePaths.delete(path);
  }
  diff.removed = [...remotePaths];
  return diff;
}

export async function loadManifest(path: string): Promise<Manifest | null> {
  try {
    const buf = await readFile(path);
    return JSON.parse(buf.toString('utf-8')) as Manifest;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export async function saveManifest(path: string, manifest: Manifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2));
}
