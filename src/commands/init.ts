import { select, password, confirm } from '@inquirer/prompts';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveToolPath } from '../adapters/paths.js';
import type { SupportedTool } from '../adapters/types.js';

const CORTEX_DIR = join(homedir(), '.cortex');
const CONFIG_PATH = join(CORTEX_DIR, 'config.json');

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function detectInstalledTools(): Promise<SupportedTool[]> {
  const candidates: SupportedTool[] = ['claude-code', 'antigravity', 'cursor'];
  const detected: SupportedTool[] = [];
  for (const tool of candidates) {
    if (await pathExists(resolveToolPath(tool))) detected.push(tool);
  }
  return detected;
}

export async function initCommand(): Promise<void> {
  console.log('cortex init — configure your sync setup\n');

  const storage = await select<'gdrive' | 'github'>({
    message: 'Where do you want to store your synced files?',
    choices: [
      { name: 'Google Drive (default, 15GB free)', value: 'gdrive' },
      { name: 'GitHub (private repo)', value: 'github' },
    ],
  });

  // Passphrase is used at runtime to derive the AES key. It is never written
  // to disk — re-prompted on each sync/pull.
  await password({
    message: 'Encryption passphrase (min 12 chars, never stored — keep it safe):',
    mask: '*',
    validate: (v) => v.length >= 12 || 'Minimum 12 characters',
  });

  const detected = await detectInstalledTools();
  console.log(`\nDetected tools: ${detected.length ? detected.join(', ') : 'none'}`);

  const proceed = await confirm({ message: 'Save configuration?', default: true });
  if (!proceed) {
    console.log('Aborted.');
    return;
  }

  await mkdir(CORTEX_DIR, { recursive: true });
  const config = {
    version: 1,
    storage,
    tools: detected,
    createdAt: new Date().toISOString(),
  };
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`\n✓ Configuration saved to ${CONFIG_PATH}`);
  console.log('Next step: run "cortex sync" to authenticate your storage and upload files.');
}
