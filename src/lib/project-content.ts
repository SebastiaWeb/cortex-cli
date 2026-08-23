import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localSessionsDir, readSessionFiles } from './team-sessions.js';
import { findClaudeMd, readSkillsFromDir, stripCortexPathBlock } from './claude-skills.js';
import { remapJsonlBuffer } from './jsonl-remapper.js';
import { safeJoin } from './safe-path.js';

/**
 * Assembles everything cortex sync tracks for a single project — session
 * history, CLAUDE.md, and skills — keyed by their relative storage path.
 * Extra .md docs are collected separately by the caller (their inclusion
 * requires interactive approval, same as cortex team push).
 */
export async function collectProjectFiles(cwd: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();

  const sessions = await readSessionFiles(localSessionsDir(cwd));
  for (const [filename, content] of sessions) {
    files.set(`sessions/${filename}`, content);
  }

  const claudeMd = await findClaudeMd(cwd);
  if (claudeMd) {
    files.set('CLAUDE.md', Buffer.from(stripCortexPathBlock(claudeMd.content), 'utf-8'));
  }

  const skills = await readSkillsFromDir(join(cwd, '.claude', 'skills'));
  for (const [filename, content] of skills) {
    files.set(`skills/${filename}`, Buffer.from(content, 'utf-8'));
  }

  return files;
}

/**
 * Writes downloaded session files into this project's local session dir,
 * remapping structural path fields when the remote originalPath differs
 * from the local cwd (i.e. pulling onto a different machine).
 *
 * Returns the content actually written per filename, so callers can record
 * the REMAPPED checksum (what's really on disk) rather than the remote one —
 * otherwise every subsequent pull would re-download unchanged files.
 */
export async function placeSessionFiles(
  cwd: string,
  sessionFiles: Map<string, Buffer>,
  remoteOriginalPath: string | null,
): Promise<Map<string, Buffer>> {
  const written = new Map<string, Buffer>();
  if (sessionFiles.size === 0) return written;
  const dir = localSessionsDir(cwd);
  await mkdir(dir, { recursive: true });
  for (const [filename, content] of sessionFiles) {
    const remapped =
      remoteOriginalPath && remoteOriginalPath !== cwd
        ? remapJsonlBuffer(content, remoteOriginalPath, cwd)
        : content;
    await writeFile(safeJoin(dir, filename), remapped);
    written.set(filename, remapped);
  }
  return written;
}
