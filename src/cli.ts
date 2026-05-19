import { createRequire } from 'node:module';
import { Command } from 'commander';
import { convertCommand, type ConvertTarget } from './commands/convert.js';
import { initCommand } from './commands/init.js';
import { mcpCommand } from './commands/mcp.js';
import { setupMcpCommand } from './commands/setup-mcp.js';
import { pullCommand } from './commands/pull.js';
import { statusCommand } from './commands/status.js';
import { syncCommand } from './commands/sync.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const program = new Command();

program
  .name('cortex')
  .description('Sync Claude Code context between machines with path remapping')
  .version(version);

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
  .action((opts) => void pullCommand(opts));

program
  .command('status')
  .description('Show what is out of sync between local files and storage')
  .option('--target <path>', 'Override storage to a local folder (overrides config)')
  .action(statusCommand);

program
  .command('convert <skill-file>')
  .description('Convert a Claude Code skill to Antigravity or Cursor format')
  .requiredOption('--to <target>', 'Target format: antigravity | cursor | all')
  .option('--output-dir <path>', 'Project root where output files are written (default: cwd)')
  .action((skillFile: string, opts: { to: string; outputDir?: string }) => {
    const validTargets: ConvertTarget[] = ['antigravity', 'cursor', 'all'];
    if (!validTargets.includes(opts.to as ConvertTarget)) {
      console.error(`Invalid target "${opts.to}". Use: antigravity, cursor, or all`);
      process.exit(1);
    }
    return convertCommand(skillFile, { to: opts.to as ConvertTarget, outputDir: opts.outputDir });
  });

program
  .command('mcp')
  .description('Start the MCP server (for use with claude mcp add cortex -- cortex mcp)')
  .action(mcpCommand);

program
  .command('setup-mcp')
  .description('Register cortex as a Claude Code MCP server automatically')
  .action(setupMcpCommand);

await program.parseAsync(process.argv);
