import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { encodeProjectPath } from './path-encoder.js';
import { identifyProject } from './project-identifier.js';
import { encrypt, decrypt, type DerivedKey } from './crypto.js';
import { TEAM_DIR } from './team-repo.js';
import { remapJsonlBuffer, extractCwdFromJsonl } from './jsonl-remapper.js';

export function localSessionsDir(cwd: string): string {
  return join(homedir(), '.claude', 'projects', encodeProjectPath(cwd));
}

export function teamSessionsDir(base: string, email: string, projectId: string): string {
  return join(base, 'sessions', email, projectId);
}

export async function readSessionFiles(dir: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (entry.endsWith('.jsonl')) {
        result.set(entry, await readFile(join(dir, entry)));
      }
    }
  } catch { /* dir doesn't exist — return empty */ }
  return result;
}

export async function copySessionsToTeamDir(
  srcDir: string,
  destDir: string,
  derived?: DerivedKey,
): Promise<number> {
  const sessions = await readSessionFiles(srcDir);
  if (sessions.size === 0) return 0;
  await mkdir(destDir, { recursive: true });
  for (const [filename, content] of sessions) {
    if (derived) {
      await writeFile(join(destDir, `${filename}.enc`), encrypt(content, derived));
    } else {
      await writeFile(join(destDir, filename), content);
    }
  }
  return sessions.size;
}

export async function copySessionsFromRepo(
  sessionsRoot: string,
  projectId: string,
  destDir: string,
  localCwd: string,
  derived?: DerivedKey,
): Promise<number> {
  let devFolders: string[];
  try {
    devFolders = await readdir(sessionsRoot);
  } catch {
    return 0;
  }
  await mkdir(destDir, { recursive: true });
  let count = 0;
  for (const email of devFolders) {
    const projDir = join(sessionsRoot, email, projectId);
    let files: string[];
    try {
      files = await readdir(projDir);
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const isEnc = file.endsWith('.jsonl.enc');
        const isPlain = file.endsWith('.jsonl') && !isEnc;
        if (!isEnc && !isPlain) continue;
        if (isEnc && !derived) continue; // can't decrypt without passphrase — skip silently

        let data: Buffer = await readFile(join(projDir, file));
        if (isEnc && derived) {
          data = decrypt(data, derived);
        }

        const remoteCwd = extractCwdFromJsonl(data);
        if (remoteCwd && remoteCwd !== localCwd) {
          data = remapJsonlBuffer(data, remoteCwd, localCwd);
        }

        const destFilename = isEnc ? file.slice(0, -'.enc'.length) : file;
        const destPath = join(destDir, destFilename);

        let finalPath = destPath;
        try {
          await readFile(destPath);
          // File already exists — suffix with first 3 chars of dev name
          const initials = email.split('@')[0].slice(0, 3);
          const base = destFilename.slice(0, -'.jsonl'.length);
          finalPath = join(destDir, `${base}.${initials}.jsonl`);
        } catch { /* doesn't exist, use destPath */ }

        await writeFile(finalPath, data);
        count++;
      } catch {
        continue;
      }
    }
  }
  return count;
}

export async function pushSessions(
  email: string,
  cwd: string,
  derived?: DerivedKey,
  projectId?: string,
): Promise<number> {
  const id = projectId ?? identifyProject(cwd)?.projectId;
  if (!id) return 0;
  const srcDir = localSessionsDir(cwd);
  const destDir = teamSessionsDir(TEAM_DIR, email, id);
  return copySessionsToTeamDir(srcDir, destDir, derived);
}

export async function pullSessions(
  cwd: string,
  derived?: DerivedKey,
  projectId?: string,
): Promise<number> {
  const id = projectId ?? identifyProject(cwd)?.projectId;
  if (!id) return 0;
  const sessionsRoot = join(TEAM_DIR, 'sessions');
  const destDir = localSessionsDir(cwd);
  return copySessionsFromRepo(sessionsRoot, id, destDir, cwd, derived);
}
