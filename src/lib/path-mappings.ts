import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { CORTEX_DIR } from './config.js';
import { join } from 'node:path';

export const MAPPINGS_PATH = join(CORTEX_DIR, 'path-mappings.json');

export type PathMappings = Record<string, string>; // projectId → absolute local path

export async function loadMappings(): Promise<PathMappings> {
  if (!existsSync(MAPPINGS_PATH)) return {};
  try {
    return JSON.parse(await readFile(MAPPINGS_PATH, 'utf-8')) as PathMappings;
  } catch {
    return {};
  }
}

export async function saveMappings(mappings: PathMappings): Promise<void> {
  await mkdir(dirname(MAPPINGS_PATH), { recursive: true });
  await writeFile(MAPPINGS_PATH, JSON.stringify(mappings, null, 2), 'utf-8');
}

export async function setMapping(projectId: string, localPath: string): Promise<void> {
  const mappings = await loadMappings();
  mappings[projectId] = localPath;
  await saveMappings(mappings);
}
