import { createRequire } from 'node:module';
import { Command } from 'commander';
import { convertCommand, type ConvertTarget } from './commands/convert.js';
import { initCommand } from './commands/init.js';
import { setTokenCommand } from './commands/set-token.js';
import { mcpCommand } from './commands/mcp.js';
import { setupMcpCommand } from './commands/setup-mcp.js';
import { pullCommand } from './commands/pull.js';
import { statusCommand } from './commands/status.js';
import { syncCommand } from './commands/sync.js';
import { teamInitCommand } from './commands/team/init.js';
import { teamPushCommand } from './commands/team/push.js';
import { teamPullCommand } from './commands/team/pull.js';
import { installCommand } from './commands/install.js';

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
  .command('set-token <token>')
  .description('Update your GitHub PAT without reconfiguring everything else')
  .action((token: string) => void setTokenCommand(token));

program
  .command('sync')
  .description('Sync this project (sessions, CLAUDE.md, skills, docs) to your personal storage — scoped to the current directory, like cortex team')
  .option('--target <path>', 'Override storage to a local folder (overrides config)')
  .option('--skip-secrets-check', 'Skip the regex scan for API keys before encrypting')
  .option('--redact', 'Replace detected secrets (API keys, tokens, private keys) with a placeholder before encrypting')
  .action(syncCommand);

program
  .command('pull')
  .description('Download this project\'s synced context from your personal storage and restore it here')
  .option('--target <path>', 'Override storage to a local folder (overrides config)')
  .action((opts) => void pullCommand(opts));

program
  .command('status')
  .description('Show what is out of sync between this project and your personal storage')
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

const team = program
  .command('team')
  .description('Share Claude Code context with your team');

team
  .command('init')
  .description('Publish your Claude setup to a shared GitHub repo')
  .option('--repo <url>', 'Team config repo URL (https://github.com/user/claude-config)')
  .action((opts) => void teamInitCommand(opts));

team
  .command('push')
  .description('Push local skill/CLAUDE.md/plugin changes to the team repo')
  .action(() => void teamPushCommand());

team
  .command('pull')
  .description('Pull team context updates and install with conflict resolution')
  .action(() => void teamPullCommand());

program
  .command('install')
  .description('First-time install of team Claude context from shared repo')
  .option('--repo <url>', 'Team config repo URL (overrides stored config)')
  .action((opts) => void installCommand(opts));

await program.parseAsync(process.argv);
