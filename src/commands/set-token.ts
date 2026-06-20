import { chmod, writeFile } from 'node:fs/promises';
import { CONFIG_PATH, loadConfig } from '../lib/config.js';
import { fetchGitHubUser } from '../storage/github.js';

export async function setTokenCommand(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed.startsWith('gh')) {
    throw new Error('Token should start with "gh". Create one at: https://github.com/settings/tokens/new?scopes=repo');
  }

  const config = await loadConfig();

  console.log('Validating token…');
  const owner = await fetchGitHubUser(trimmed);
  console.log(`✓ Authenticated as ${owner}`);

  const updated = { ...config, githubToken: trimmed, githubOwner: owner };
  await writeFile(CONFIG_PATH, JSON.stringify(updated, null, 2), { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600);
  console.log('✓ Token updated. You can now run cortex sync / pull / team push / install.');
}
