import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const INSTALLED_PLUGINS_PATH = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');

interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, unknown[]>;
}

export function parseInstalledPlugins(data: InstalledPluginsFile): string[] {
  return Object.keys(data.plugins);
}

export async function getInstalledPluginIds(): Promise<string[]> {
  try {
    const buf = await readFile(INSTALLED_PLUGINS_PATH, 'utf-8');
    return parseInstalledPlugins(JSON.parse(buf) as InstalledPluginsFile);
  } catch {
    return [];
  }
}

export function installPlugin(pluginId: string): void {
  console.log(`Installing plugin: ${pluginId}`);
  const result = spawnSync('claude', ['plugin', 'install', pluginId], { stdio: 'inherit' });
  if (result.error) throw new Error(`Failed to run claude: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Plugin install failed for ${pluginId}`);
}
