import { password, confirm } from '@inquirer/prompts';
import { existsSync } from 'node:fs';
import { chmod, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { CORTEX_DIR, loadConfig } from './config.js';
import { deriveKey, encrypt, decrypt } from './crypto.js';
import { readPassphrase } from './passphrase.js';

export const API_KEY_PATH = join(CORTEX_DIR, 'api-key.enc');

/**
 * Load the Anthropic API key using this priority:
 *  1. ANTHROPIC_API_KEY env var
 *  2. ~/.cortex/api-key.enc (AES-256-GCM, same passphrase as sync)
 *  3. Interactive prompt — offers to save encrypted for next time
 */
export async function loadApiKey(): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;

  if (existsSync(API_KEY_PATH)) {
    const config = await loadConfig();
    const passphrase = await readPassphrase();
    const derived = deriveKey(passphrase, config.email);
    const enc = await readFile(API_KEY_PATH);
    return decrypt(enc, derived).toString('utf-8').trim();
  }

  const key = await password({
    message: 'Anthropic API key (sk-ant-...):',
    mask: '*',
    validate: (v) => v.trim().startsWith('sk-ant-') || 'Key should start with sk-ant-',
  });

  const save = await confirm({
    message: 'Save encrypted to ~/.cortex/api-key.enc? (requires your sync passphrase)',
    default: true,
  });
  if (save) {
    const config = await loadConfig();
    const passphrase = await readPassphrase();
    const derived = deriveKey(passphrase, config.email);
    const enc = encrypt(Buffer.from(key.trim(), 'utf-8'), derived);
    await mkdir(dirname(API_KEY_PATH), { recursive: true });
    await writeFile(API_KEY_PATH, enc, { mode: 0o600 });
    await chmod(API_KEY_PATH, 0o600);
    console.log(`✓ API key saved to ${API_KEY_PATH}`);
  }

  return key.trim();
}
