import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export const LOCAL_SKILLS_DIR = join(homedir(), '.claude', 'skills');
export const LOCAL_CLAUDE_MD = join(homedir(), '.claude', 'CLAUDE.md');

export async function readSkillsFromDir(dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return map;
  }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.md')) {
      const content = await readFile(join(dir, e.name), 'utf-8');
      map.set(e.name, content);
    }
  }
  return map;
}

export async function writeSkillToDir(dir: string, filename: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), content, 'utf-8');
}

export async function readFileFromPath(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function writeFileToPath(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}
