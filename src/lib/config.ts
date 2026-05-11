import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CortexConfig } from '../commands/init.js';

export const CORTEX_DIR = join(homedir(), '.cortex');
export const CONFIG_PATH = join(CORTEX_DIR, 'config.json');
export const MANIFEST_PATH = join(CORTEX_DIR, 'manifest.json');

export async function loadConfig(): Promise<CortexConfig> {
  let buf: Buffer;
  try {
    buf = await readFile(CONFIG_PATH);
  } catch {
    throw new Error(`No cortex config found at ${CONFIG_PATH}. Run "cortex init" first.`);
  }
  return JSON.parse(buf.toString('utf-8')) as CortexConfig;
}
