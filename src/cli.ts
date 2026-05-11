import { Command } from 'commander';
import { initCommand } from './commands/init.js';

const program = new Command();

program
  .name('cortex')
  .description('Sync Claude Code context between machines with path remapping')
  .version('0.0.1');

program
  .command('init')
  .description('Configure Cortex: pick storage, set passphrase, detect tools')
  .action(initCommand);

await program.parseAsync(process.argv);
