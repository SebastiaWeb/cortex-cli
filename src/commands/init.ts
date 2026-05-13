import { confirm, input, password, select } from '@inquirer/prompts';
import { access, chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveToolPath } from '../adapters/paths.js';
import type { SupportedTool } from '../adapters/types.js';
import { ensureGitHubRepo, fetchGitHubUser } from '../storage/github.js';

const CORTEX_DIR = join(homedir(), '.cortex');
const CONFIG_PATH = join(CORTEX_DIR, 'config.json');

export type StorageBackend = 'gdrive' | 'github' | 'local';

export interface CortexConfig {
  version: 1;
  storage: StorageBackend;
  email: string;
  target?: string;       // required when storage === 'local'
  githubToken?: string;  // PAT with repo scope
  githubOwner?: string;  // GitHub username (resolved from token during init)
  githubRepo?: string;   // repo name, default 'cortex-backup'
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
      { name: 'GitHub private repo (PAT — no OAuth app needed)', value: 'github' },
      { name: 'Local folder (Dropbox / iCloud Drive / Syncthing)', value: 'local' },
      { name: 'Google Drive — coming in a later release', value: 'gdrive' },
    ],
  });

  let target: string | undefined;
  let githubToken: string | undefined;
  let githubOwner: string | undefined;
  let githubRepo: string | undefined;

  if (storage === 'local') {
    target = await input({
      message: 'Path to the synced folder (e.g. ~/Dropbox/cortex-backup):',
      validate: (v) => v.trim().length > 0 || 'Required',
    });
    target = target.replace(/^~(?=\/|$)/, homedir());
  }

  if (storage === 'github') {
    console.log('\nYou need a GitHub Personal Access Token with "repo" scope.');
    console.log('Create one at: https://github.com/settings/tokens/new?scopes=repo\n');

    githubToken = await password({
      message: 'Paste your GitHub PAT (ghp_...):',
      mask: '*',
      validate: (v) => v.trim().startsWith('gh') || 'Token should start with gh',
    });

    process.stdout.write('Validating token… ');
    githubOwner = await fetchGitHubUser(githubToken.trim());
    console.log(`✓ Authenticated as ${githubOwner}`);

    githubRepo = await input({
      message: 'Repo name for the backup:',
      default: 'cortex-backup',
      validate: (v) => /^[a-zA-Z0-9_.-]+$/.test(v.trim()) || 'Invalid repo name',
    });

    process.stdout.write(`Creating private repo ${githubOwner}/${githubRepo}… `);
    await ensureGitHubRepo(githubToken.trim(), githubRepo.trim());
    console.log('✓ Ready');
    githubToken = githubToken.trim();
    githubRepo = githubRepo.trim();
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
    githubToken,
    githubOwner,
    githubRepo,
    tools: detected,
    createdAt: new Date().toISOString(),
  };
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600); // ensure even when file already existed
  console.log(`\n✓ Configuration saved to ${CONFIG_PATH}`);
  if (storage === 'github') {
    console.log(`Next step: run "cortex sync" — files will be encrypted and pushed to ${githubOwner}/${githubRepo}.`);
  } else if (storage === 'local') {
    console.log('Next step: run "cortex sync" to encrypt and upload your files to the local folder.');
  } else {
    console.log('Next step: Google Drive backend is not yet implemented — use --target <path> with "cortex sync" for now.');
  }
}
