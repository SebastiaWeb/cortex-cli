import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ProjectCortexConfig {
  repo?: string;
  shareSession?: boolean;
  encryptSessions?: boolean;
  extraDocs?: string[];
  [key: string]: unknown;
}

export async function readProjectConfig(cwd: string = process.cwd()): Promise<ProjectCortexConfig> {
  try {
    const content = await readFile(join(cwd, 'cortex.json'), 'utf-8');
    return JSON.parse(content) as ProjectCortexConfig;
  } catch {
    return {};
  }
}

export async function writeProjectConfig(
  updates: ProjectCortexConfig,
  cwd: string = process.cwd(),
): Promise<void> {
  const existing = await readProjectConfig(cwd);
  const merged = { ...existing, ...updates };
  await writeFile(join(cwd, 'cortex.json'), JSON.stringify(merged, null, 2), 'utf-8');
}
