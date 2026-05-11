import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { pullCommand } from './commands/pull.js';
import { statusCommand } from './commands/status.js';
import { syncCommand } from './commands/sync.js';

const program = new Command();

program
  .name('cortex')
  .description('Sync Claude Code context between machines with path remapping')
  .version('0.0.1');

program
  .command('init')
  .description('Configure Cortex: pick storage, set passphrase, detect tools')
  .action(initCommand);

program
  .command('sync')
  .description('Encrypt local files and upload to the configured storage')
  .option('--target <path>', 'Override storage to a local folder (overrides config)')
  .option('--skip-secrets-check', 'Skip the regex scan for API keys before encrypting')
  .action(syncCommand);

program
  .command('pull')
  .description('Download from storage and restore into ~/.claude/')
  .option('--target <path>', 'Override storage to a local folder (overrides config)')
  .action(pullCommand);

program
  .command('status')
  .description('Show what is out of sync between local files and storage')
  .option('--target <path>', 'Override storage to a local folder (overrides config)')
  .action(statusCommand);

await program.parseAsync(process.argv);
