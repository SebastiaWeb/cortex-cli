import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadApiKey } from '../lib/api-key.js';
import { convertCommand } from './convert.js';
import { initNonInteractive } from './init.js';
import { pullCommand } from './pull.js';
import { statusCommand } from './status.js';
import { syncCommand } from './sync.js';

// Permanently redirect console.log to stderr — stdout is the MCP JSON-RPC channel.
const logToStderr = (...args: unknown[]) =>
  process.stderr.write(args.map(String).join(' ') + '\n');
console.log = logToStderr;

function requirePassphrase(): void {
  if (!process.env.CORTEX_PASSPHRASE) {
    throw new Error(
      'CORTEX_PASSPHRASE environment variable is not set.\n' +
        'Run "cortex init" from your terminal first, then set:\n' +
        '  export CORTEX_PASSPHRASE="your-passphrase"',
    );
  }
}

async function captureOutput<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
  const lines: string[] = [];
  const prev = console.log;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  try {
    const result = await fn();
    console.log = prev;
    return { result, output: lines.join('\n') };
  } catch (e) {
    console.log = prev;
    throw e;
  }
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function toolErr(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: 'text' as const, text: msg }], isError: true as const };
}

export async function mcpCommand(): Promise<void> {
  const server = new McpServer({ name: 'cortex', version: '0.1.0' });

  server.registerTool(
    'sync',
    {
      description:
        'Encrypt ~/.claude/ and upload to configured storage. Requires CORTEX_PASSPHRASE env var.',
      inputSchema: z.object({
        skipSecretsCheck: z
          .boolean()
          .optional()
          .describe('Skip the API key detection warning before encrypting'),
        target: z.string().optional().describe('Override storage to a local folder path'),
      }),
    },
    async ({ skipSecretsCheck, target }) => {
      try {
        requirePassphrase();
        const { output } = await captureOutput(() => syncCommand({ skipSecretsCheck, target }));
        return ok(output);
      } catch (e) {
        return toolErr(e);
      }
    },
  );

  server.registerTool(
    'pull',
    {
      description:
        'Download from storage, decrypt, and remap paths into ~/.claude/. ' +
        'If pendingMappings is returned, call pull again with projectMappings populated.',
      inputSchema: z.object({
        target: z.string().optional().describe('Override storage to a local folder path'),
        projectMappings: z
          .record(z.string())
          .optional()
          .describe('Map of projectId or originalPath to local path on this machine'),
      }),
    },
    async ({ target, projectMappings }) => {
      try {
        requirePassphrase();
        const result = await pullCommand({ target, projectMappings, nonInteractive: true });
        if (result.pendingMappings?.length) {
          const lines = result.pendingMappings.map(
            (p) => `  "${p.originalPath}" (projectId: ${p.projectId ?? 'none'})`,
          );
          return ok(
            `Restored ${result.filesRestored} files.\n\n` +
              `These projects need a local path mapping.\n` +
              `Call pull again with projectMappings, e.g.:\n` +
              `  { "${result.pendingMappings[0].projectId ?? result.pendingMappings[0].originalPath}": "/your/local/path" }\n\n` +
              `Pending projects:\n${lines.join('\n')}`,
          );
        }
        return ok(`Pull complete. ${result.filesRestored} files restored.`);
      } catch (e) {
        return toolErr(e);
      }
    },
  );

  server.registerTool(
    'status',
    {
      description: 'Show what is out of sync between local ~/.claude/ files and storage.',
      inputSchema: z.object({
        target: z.string().optional().describe('Override storage to a local folder path'),
      }),
    },
    async ({ target }) => {
      try {
        requirePassphrase();
        const { output } = await captureOutput(() => statusCommand({ target }));
        return ok(output);
      } catch (e) {
        return toolErr(e);
      }
    },
  );

  server.registerTool(
    'convert',
    {
      description:
        'Convert a Claude Code skill to Antigravity or Cursor format using the Anthropic API. ' +
        'Requires ANTHROPIC_API_KEY env var (or ~/.cortex/api-key.enc).',
      inputSchema: z.object({
        skillPath: z.string().describe('Absolute path to the Claude Code skill .md file'),
        to: z.enum(['antigravity', 'cursor', 'all']).describe('Target format'),
        outputDir: z
          .string()
          .optional()
          .describe('Project root where output files are written (default: cwd)'),
      }),
    },
    async ({ skillPath, to, outputDir }) => {
      try {
        let apiKey: string;
        try {
          apiKey = await loadApiKey({ nonInteractive: true });
        } catch (e) {
          return toolErr(e);
        }
        const { output } = await captureOutput(() =>
          convertCommand(skillPath, { to, outputDir, apiKey }),
        );
        return ok(output);
      } catch (e) {
        return toolErr(e);
      }
    },
  );

  server.registerTool(
    'init',
    {
      description: 'Configure cortex storage. For GitHub, requires CORTEX_GITHUB_TOKEN env var.',
      inputSchema: z.object({
        email: z.string().describe('Email used as salt for key derivation'),
        storage: z.enum(['github', 'local']).describe('Storage backend'),
        githubRepo: z
          .string()
          .optional()
          .describe('GitHub repo name for backup (default: cortex-backup)'),
        target: z
          .string()
          .optional()
          .describe('Local folder path — required when storage is "local"'),
      }),
    },
    async (params) => {
      try {
        const { output } = await captureOutput(() => initNonInteractive(params));
        return ok(output);
      } catch (e) {
        return toolErr(e);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('cortex MCP server running on stdio\n');

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
}
