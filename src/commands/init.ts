import { confirm, input, password, select } from '@inquirer/prompts';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveToolPath } from '../adapters/paths.js';
import type { SupportedTool } from '../adapters/types.js';

const CORTEX_DIR = join(homedir(), '.cortex');
const CONFIG_PATH = join(CORTEX_DIR, 'config.json');

export type StorageBackend = 'gdrive' | 'github' | 'local';

export interface CortexConfig {
  version: 1;
  storage: StorageBackend;
  email: string;
  target?: string; // required when storage === 'local'
  tools: SupportedTool[];
  createdAt: string;
}

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

  const email = await input({
    message: 'Your email (used as salt for key derivation, never sent anywhere):',
    validate: (v) => /.+@.+\..+/.test(v) || 'Enter a valid email',
  });

  const storage = await select<StorageBackend>({
    message: 'Where do you want to store your synced files?',
    choices: [
      { name: 'Google Drive (default, 15GB free) — OAuth flow comes in a later release', value: 'gdrive' },
      { name: 'GitHub (private repo)        — implementation pending', value: 'github' },
      { name: 'Local folder (works with Dropbox / iCloud Drive / Syncthing)', value: 'local' },
    ],
  });

  let target: string | undefined;
  if (storage === 'local') {
    target = await input({
      message: 'Path to the synced folder (e.g. ~/Dropbox/cortex-backup):',
      validate: (v) => v.trim().length > 0 || 'Required',
    });
    target = target.replace(/^~(?=\/|$)/, homedir());
  }

  // Passphrase used at runtime to derive the AES key. Never written to disk.
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
  const config: CortexConfig = {
    version: 1,
    storage,
    email,
    target,
    tools: detected,
    createdAt: new Date().toISOString(),
  };
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`\n✓ Configuration saved to ${CONFIG_PATH}`);
  if (storage === 'local') {
    console.log('Next step: run "cortex sync" to encrypt and upload your files to the local folder.');
  } else {
    console.log(`Next step: ${storage} backend not yet implemented — use --target <path> with "cortex sync" for now.`);
  }
}
