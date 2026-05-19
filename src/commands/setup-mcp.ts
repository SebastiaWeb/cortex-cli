import { password } from '@inquirer/prompts';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

export async function setupMcpCommand(): Promise<void> {
  // Cortex binary lives in the same dir as the node executable (npm global bin)
  const cortexBin = join(dirname(process.execPath), 'cortex');

  if (!existsSync(cortexBin)) {
    throw new Error(
      `cortex binary not found at ${cortexBin}.\n` +
        'Make sure cortex-sync is installed globally: npm install -g cortex-sync',
    );
  }

  console.log(`Found cortex at: ${cortexBin}`);

  const passphrase = await password({
    message: 'Encryption passphrase (same one used in cortex init):',
    mask: '*',
    validate: (v) => v.length >= 12 || 'Minimum 12 characters',
  });

  const result = spawnSync(
    'claude',
    ['mcp', 'add', 'cortex', '-e', `CORTEX_PASSPHRASE=${passphrase}`, '--', cortexBin, 'mcp'],
    { stdio: 'inherit' },
  );

  if (result.error) {
    throw new Error(
      `Failed to run "claude" CLI: ${result.error.message}\n` +
        'Make sure Claude Code CLI is installed and "claude" is in your PATH.',
    );
  }
  if (result.status !== 0) {
    throw new Error('"claude mcp add" failed. Check the output above for details.');
  }

  console.log('\n✓ cortex MCP server registered in Claude Code.');
  console.log('Restart Claude Code (or open a new session) to activate it.');
  console.log('\nTo verify: claude mcp list');
}
