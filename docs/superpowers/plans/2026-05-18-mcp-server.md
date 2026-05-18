# MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `cortex mcp` subcommand that exposes cortex functionality as a Claude Code MCP server, alongside the existing CLI.

**Architecture:** Thin wrapper — the MCP server imports existing command functions and wraps them as MCP tools. The key changes are: (1) `pull.ts` gains a `nonInteractive` mode that returns `pendingMappings` instead of prompting, (2) `api-key.ts` gains a `nonInteractive` mode that throws instead of prompting, (3) `convert.ts` accepts a pre-loaded `apiKey`, (4) `init.ts` gains an `initNonInteractive` function, (5) a new `src/commands/mcp.ts` wires everything together. `console.log` is permanently redirected to `stderr` inside the MCP server so it doesn't corrupt the JSON-RPC stdout channel.

**Tech Stack:** `@modelcontextprotocol/sdk` (McpServer + StdioServerTransport), `zod` for input schemas, vitest for tests.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `package.json` | Modify | Add `@modelcontextprotocol/sdk` and `zod` dependencies |
| `src/commands/mcp.ts` | **Create** | MCP server: 5 tools, console redirect, error handling |
| `src/cli.ts` | Modify | Add `cortex mcp` subcommand |
| `src/commands/pull.ts` | Modify | `PullResult` return type, `nonInteractive` + `projectMappings` options, export `resolveLocalPath` |
| `src/lib/api-key.ts` | Modify | Add `LoadApiKeyOptions.nonInteractive` — throws instead of prompting |
| `src/commands/convert.ts` | Modify | `ConvertOptions.apiKey` — accept pre-loaded key, skip `loadApiKey()` call |
| `src/commands/init.ts` | Modify | Add `initNonInteractive()` — no interactive prompts |
| `tests/lib/passphrase.test.ts` | **Create** | Env var takes priority over interactive prompt |
| `tests/commands/pull-noninteractive.test.ts` | **Create** | `resolveLocalPath` nonInteractive behavior |

---

## Task 1: Add dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
npm install @modelcontextprotocol/sdk zod
```

Expected: packages added to `node_modules`, `package.json` updated with both deps.

- [ ] **Step 2: Verify build still passes**

```bash
npm run build
```

Expected: `ESM dist/cli.js` and no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @modelcontextprotocol/sdk and zod dependencies"
```

---

## Task 2: Test and document passphrase env var (already implemented)

`src/lib/passphrase.ts` already reads `CORTEX_PASSPHRASE` env var. This task adds the missing test.

**Files:**
- Create: `tests/lib/passphrase.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/passphrase.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { readPassphrase } from '../../src/lib/passphrase.js';

describe('readPassphrase', () => {
  afterEach(() => {
    delete process.env.CORTEX_PASSPHRASE;
  });

  it('returns CORTEX_PASSPHRASE env var without prompting', async () => {
    process.env.CORTEX_PASSPHRASE = 'env-passphrase-12chars';
    const result = await readPassphrase();
    expect(result).toBe('env-passphrase-12chars');
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/passphrase.test.ts
```

Expected: PASS (env var path already implemented).

- [ ] **Step 3: Commit**

```bash
git add tests/lib/passphrase.test.ts
git commit -m "test: passphrase reads CORTEX_PASSPHRASE env var"
```

---

## Task 3: Modify pull.ts — nonInteractive mode + PullResult

**Files:**
- Modify: `src/commands/pull.ts`
- Create: `tests/commands/pull-noninteractive.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/commands/pull-noninteractive.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveLocalPath } from '../../src/commands/pull.js';

describe('resolveLocalPath', () => {
  it('returns null in nonInteractive mode when project is unknown', async () => {
    const result = await resolveLocalPath(
      'proj-abc123',
      '/Users/alice/work/myapp',
      {},
      undefined,
      true,
    );
    expect(result).toBeNull();
  });

  it('uses projectMappings by projectId', async () => {
    const result = await resolveLocalPath(
      'proj-abc123',
      '/Users/alice/work/myapp',
      {},
      { 'proj-abc123': '/home/alice/myapp' },
      true,
    );
    expect(result).toBe('/home/alice/myapp');
  });

  it('uses projectMappings by originalPath when projectId is null', async () => {
    const result = await resolveLocalPath(
      null,
      '/Users/alice/work/myapp',
      {},
      { '/Users/alice/work/myapp': '/home/alice/myapp' },
      true,
    );
    expect(result).toBe('/home/alice/myapp');
  });

  it('uses stored mappings when no projectMappings provided', async () => {
    const result = await resolveLocalPath(
      'proj-abc123',
      '/Users/alice/work/myapp',
      { 'proj-abc123': '/home/alice/myapp' },
      undefined,
      true,
    );
    expect(result).toBe('/home/alice/myapp');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/commands/pull-noninteractive.test.ts
```

Expected: FAIL — `resolveLocalPath` is not exported.

- [ ] **Step 3: Modify pull.ts**

Open `src/commands/pull.ts`. Make these changes:

**a) Update imports at the top** — no new imports needed.

**b) Replace `PullOptions` interface and add `PullResult`:**

```ts
export interface PullOptions {
  target?: string;
  projectMappings?: Record<string, string>;
  nonInteractive?: boolean;
}

export interface PullResult {
  filesRestored: number;
  pendingMappings?: Array<{
    encodedDir: string;
    projectId: string | null;
    originalPath: string;
  }>;
}
```

**c) Export `resolveLocalPath` and update its signature:**

Replace the existing private `resolveLocalPath` function with this exported version:

```ts
export async function resolveLocalPath(
  projectId: string | null,
  originalPath: string,
  mappings: Record<string, string>,
  projectMappings?: Record<string, string>,
  nonInteractive?: boolean,
): Promise<string | null> {
  const key = projectId ?? originalPath;

  if (projectMappings?.[key]) return projectMappings[key];
  if (projectId && projectMappings?.[originalPath]) return projectMappings[originalPath];

  if (mappings[key]) return mappings[key];
  if (projectId && mappings[originalPath]) return mappings[originalPath];

  if (existsSync(originalPath)) return originalPath;

  if (nonInteractive) return null;

  console.log(`\nProject not found on this machine:`);
  console.log(`  Original path: ${originalPath}`);
  if (projectId) console.log(`  Project ID:    ${projectId}`);
  const answer = await input({
    message: 'Local path (leave empty to skip this project):',
  });
  if (!answer.trim()) return null;
  return answer.trim();
}
```

**d) Update `pullCommand` signature and body:**

Change the function signature to return `Promise<PullResult>`:

```ts
export async function pullCommand(opts: PullOptions = {}): Promise<PullResult> {
```

After the `mappings` and `dirRemap` declarations, add:

```ts
const pendingMappings: Array<{
  encodedDir: string;
  projectId: string | null;
  originalPath: string;
}> = [];
```

In the loop that builds `dirRemap`, replace the call to the old `resolveLocalPath` with:

```ts
const localPath = await resolveLocalPath(
  meta.projectId,
  meta.originalPath,
  mappings,
  opts.projectMappings,
  opts.nonInteractive,
);
if (localPath === null) {
  if (opts.nonInteractive) {
    pendingMappings.push({
      encodedDir,
      projectId: meta.projectId,
      originalPath: meta.originalPath,
    });
  }
  dirRemap.set(encodedDir, null);
  continue;
}
```

Replace the final `console.log` line and add the return:

```ts
console.log(`\n✓ Pull complete — ${toPull.length} files restored.`);
return {
  filesRestored: toPull.length,
  pendingMappings: pendingMappings.length > 0 ? pendingMappings : undefined,
};
```

- [ ] **Step 4: Run tests**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/commands/pull-noninteractive.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/commands/pull.ts tests/commands/pull-noninteractive.test.ts
git commit -m "feat: pull nonInteractive mode with projectMappings and PullResult"
```

---

## Task 4: Modify api-key.ts — nonInteractive mode

**Files:**
- Modify: `src/lib/api-key.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/` a new file `tests/lib/api-key.test.ts`:

```ts
import { describe, expect, it, afterEach } from 'vitest';
import { loadApiKey } from '../../src/lib/api-key.js';

describe('loadApiKey nonInteractive', () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns ANTHROPIC_API_KEY env var', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    const key = await loadApiKey({ nonInteractive: true });
    expect(key).toBe('sk-ant-test-key');
  });

  it('throws in nonInteractive mode when no key available', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(loadApiKey({ nonInteractive: true })).rejects.toThrow('ANTHROPIC_API_KEY');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/api-key.test.ts
```

Expected: FAIL — `loadApiKey` doesn't accept options yet.

- [ ] **Step 3: Modify api-key.ts**

Open `src/lib/api-key.ts`. Add the `LoadApiKeyOptions` interface and update the function signature:

At the top, after the imports, add:

```ts
export interface LoadApiKeyOptions {
  nonInteractive?: boolean;
}
```

Change the function signature from:

```ts
export async function loadApiKey(): Promise<string> {
```

To:

```ts
export async function loadApiKey(opts: LoadApiKeyOptions = {}): Promise<string> {
```

After the `existsSync(API_KEY_PATH)` block, add the nonInteractive guard before the interactive prompt:

```ts
  if (opts.nonInteractive) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is not set and no encrypted key found.\n' +
        'Set it with: export ANTHROPIC_API_KEY="sk-ant-..."',
    );
  }
```

- [ ] **Step 4: Run tests**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/api-key.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api-key.ts tests/lib/api-key.test.ts
git commit -m "feat: api-key nonInteractive mode throws instead of prompting"
```

---

## Task 5: Modify convert.ts — accept pre-loaded apiKey

**Files:**
- Modify: `src/commands/convert.ts`

No new tests needed — existing convert tests cover behavior. This is a pure additive change.

- [ ] **Step 1: Update ConvertOptions in convert.ts**

Open `src/commands/convert.ts`. Add `apiKey?` to the interface:

```ts
export interface ConvertOptions {
  to: ConvertTarget;
  outputDir?: string;
  apiKey?: string;
}
```

Change the `loadApiKey()` call inside `convertCommand`:

```ts
  const apiKey = opts.apiKey ?? (await loadApiKey());
```

- [ ] **Step 2: Build and test**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build && npm test
```

Expected: build succeeds, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/commands/convert.ts
git commit -m "feat: convert accepts pre-loaded apiKey to skip loadApiKey call"
```

---

## Task 6: Add initNonInteractive to init.ts

**Files:**
- Modify: `src/commands/init.ts`

- [ ] **Step 1: Add the export to init.ts**

Open `src/commands/init.ts`. Add the following interface and function at the bottom of the file, after the existing `initCommand`:

```ts
export interface NonInteractiveInitOptions {
  email?: string;
  storage?: 'github' | 'local';
  githubRepo?: string;
  target?: string;
}

export async function initNonInteractive(opts: NonInteractiveInitOptions): Promise<void> {
  if (!opts.email) throw new Error('email is required');
  if (!opts.storage) throw new Error('storage is required: "github" or "local"');
  if (opts.storage === 'local' && !opts.target) {
    throw new Error('target path is required when storage is "local"');
  }

  let githubToken: string | undefined;
  let githubOwner: string | undefined;
  let githubRepo: string | undefined;

  if (opts.storage === 'github') {
    githubToken = process.env.CORTEX_GITHUB_TOKEN;
    if (!githubToken) {
      throw new Error(
        'CORTEX_GITHUB_TOKEN environment variable is not set.\n' +
          'Create a PAT at: https://github.com/settings/tokens/new?scopes=repo\n' +
          'Then set: export CORTEX_GITHUB_TOKEN="ghp_..."',
      );
    }
    githubOwner = await fetchGitHubUser(githubToken);
    console.log(`✓ Authenticated as ${githubOwner}`);
    githubRepo = opts.githubRepo ?? 'cortex-backup';
    await ensureGitHubRepo(githubToken, githubRepo);
    console.log(`✓ Repo ${githubOwner}/${githubRepo} ready`);
  }

  const detected = await detectInstalledTools();

  await mkdir(CORTEX_DIR, { recursive: true });
  const config: CortexConfig = {
    version: 1,
    storage: opts.storage,
    email: opts.email,
    target: opts.target,
    githubToken,
    githubOwner,
    githubRepo,
    tools: detected,
    createdAt: new Date().toISOString(),
  };
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600);
  console.log(`✓ Configuration saved to ${CONFIG_PATH}`);
}
```

- [ ] **Step 2: Build to verify**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/commands/init.ts
git commit -m "feat: add initNonInteractive for MCP server use"
```

---

## Task 7: Create src/commands/mcp.ts

**Files:**
- Create: `src/commands/mcp.ts`

- [ ] **Step 1: Create the file**

Create `src/commands/mcp.ts` with the following content:

```ts
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
      description:
        'Configure cortex storage. For GitHub, requires CORTEX_GITHUB_TOKEN env var.',
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
```

- [ ] **Step 2: Build to verify TypeScript compiles**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build
```

Expected: `ESM dist/cli.js` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/mcp.ts
git commit -m "feat: add MCP server command (cortex mcp)"
```

---

## Task 8: Wire up cortex mcp subcommand in cli.ts

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add import and subcommand**

Open `src/cli.ts`. Add the import at the top with the other command imports:

```ts
import { mcpCommand } from './commands/mcp.js';
```

Add the subcommand before `await program.parseAsync(process.argv)`:

```ts
program
  .command('mcp')
  .description('Start the MCP server (for use with claude mcp add cortex -- cortex mcp)')
  .action(mcpCommand);
```

- [ ] **Step 2: Build**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build
```

Expected: no errors.

- [ ] **Step 3: Smoke test — verify cortex mcp starts**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node dist/cli.js mcp
```

Expected: a JSON-RPC response on stdout and `cortex MCP server running on stdio` on stderr.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: wire cortex mcp subcommand into CLI"
```

---

## Task 9: Update README and push

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add MCP section to README**

Open `README.md`. Add a new section after the **Commands** table:

```markdown
## Claude Code MCP integration

Install cortex as a Claude Code MCP server to use it directly from the chat:

```bash
npm install -g cortex-sync
cortex init                           # configure once from terminal
export CORTEX_PASSPHRASE="..."        # add to ~/.zshrc
claude mcp add cortex -- cortex mcp  # register
```

Claude Code will now have access to `sync`, `pull`, `status`, `convert`, and `init` tools.

| Tool | What it does |
|---|---|
| `sync` | Encrypt and upload `~/.claude/` |
| `pull` | Download, decrypt, remap paths |
| `status` | Show what's out of sync |
| `convert` | Convert a skill to Antigravity or Cursor |
| `init` | Configure storage (non-interactive) |

**Environment variables:**

| Variable | Required for |
|---|---|
| `CORTEX_PASSPHRASE` | `sync`, `pull`, `status` |
| `ANTHROPIC_API_KEY` | `convert` |
| `CORTEX_GITHUB_TOKEN` | `init` with GitHub storage |
```

- [ ] **Step 2: Commit and push**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add README.md
git commit -m "docs: add MCP server installation and usage section"
git push
```

Expected: all 6 new commits pushed to GitHub.
