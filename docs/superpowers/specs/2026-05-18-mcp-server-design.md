# MCP Server for cortex-sync — Design Spec

**Date:** 2026-05-18
**Status:** Approved
**Scope:** Add `cortex mcp` subcommand exposing cortex functionality as a Claude Code MCP server, alongside the existing CLI (Option C).

---

## Problem

`cortex-sync` is currently a standalone CLI. Users must leave Claude Code to run `cortex sync`, `cortex pull`, etc. from the terminal. There is no way to install it through the Claude Code plugin marketplace.

---

## Goals

1. Expose cortex functionality as MCP tools usable from within Claude Code.
2. Keep the existing CLI working exactly as before — no regressions.
3. Be installable via `claude mcp add cortex -- cortex mcp`.

---

## Architecture

### Approach: Thin wrapper over existing commands

The MCP server imports existing command functions (`syncCommand`, `pullCommand`, etc.) and wraps them as MCP tools. Minimal changes to existing code.

### New files

| File | Purpose |
|---|---|
| `src/commands/mcp.ts` | Starts the MCP server with stdio transport |

### Modified files

| File | Change |
|---|---|
| `src/cli.ts` | Add `mcp` subcommand |
| `src/lib/passphrase.ts` | Read `CORTEX_PASSPHRASE` env var before interactive prompt |
| `src/commands/pull.ts` | Add `nonInteractive` + `projectMappings` + `PullResult` return type |
| `src/commands/init.ts` | Accept optional params for non-interactive init |
| `package.json` | Add `@modelcontextprotocol/sdk` dependency |

### New dependency

`@modelcontextprotocol/sdk` — official MCP TypeScript SDK, stdio transport.

---

## MCP Tools

### `sync`
Encrypts and uploads `~/.claude/` to configured storage.

**Env required:** `CORTEX_PASSPHRASE`

**Params:**
- `skipSecretsCheck?: boolean` — skip API key detection warning
- `target?: string` — override storage target path

**Returns:** Summary string (files uploaded, deleted).

---

### `pull`
Downloads, decrypts, and remaps paths from storage to local machine.

**Env required:** `CORTEX_PASSPHRASE`

**Params:**
- `target?: string` — override storage target path
- `projectMappings?: Record<string, string>` — map of projectId/originalPath → local path

**Returns:**
```ts
{
  filesRestored: number;
  pendingMappings?: Array<{
    encodedDir: string;
    projectId: string | null;
    originalPath: string;
  }>;
}
```

**Two-step flow for unknown projects:**
1. First call returns `pendingMappings` for projects Claude doesn't know the local path for.
2. Claude asks the user in chat, then calls `pull` again with `projectMappings` populated.

---

### `status`
Shows what's out of sync without downloading anything.

**Env required:** `CORTEX_PASSPHRASE`

**Params:**
- `target?: string`

**Returns:** Diff summary string.

---

### `convert`
Converts a Claude Code skill to Antigravity or Cursor format.

**Env required:** `ANTHROPIC_API_KEY` (if not set and `~/.cortex/api-key.enc` doesn't exist, tool returns error instead of prompting interactively)

**Params:**
- `skillPath: string` — absolute path to the skill `.md` file
- `to: 'antigravity' | 'cursor' | 'all'`
- `outputDir?: string` — defaults to current working directory

**Returns:** Summary of files written.

---

### `init`
Hybrid init — configures non-sensitive settings via MCP. Sensitive credentials via env vars.

**Env vars (optional):**
- `CORTEX_GITHUB_TOKEN` — GitHub PAT (required if `storage === 'github'`)

**Params:**
- `email?: string`
- `storage?: 'github' | 'local'`
- `githubRepo?: string` — default `'cortex-backup'`
- `target?: string` — required if `storage === 'local'`

**Returns:** Config summary or error with instructions if env vars missing.

---

## Passphrase Handling

`src/lib/passphrase.ts` is modified to check `CORTEX_PASSPHRASE` env var first:

```ts
export async function readPassphrase(): Promise<string> {
  if (process.env.CORTEX_PASSPHRASE) return process.env.CORTEX_PASSPHRASE;
  // existing interactive prompt (CLI only)
}
```

If `CORTEX_PASSPHRASE` is not set when a tool requires it, the tool returns:
```
Error: CORTEX_PASSPHRASE environment variable is not set.
Run "cortex init" from your terminal first, then set:
  export CORTEX_PASSPHRASE="your-passphrase"
```

---

## Pull: Non-Interactive Mode

`PullOptions` is extended:

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

When `nonInteractive: true`:
- Projects in `projectMappings` → remapped and restored normally.
- Unknown projects → added to `pendingMappings`, skipped (no error thrown).
- CLI path unchanged — `nonInteractive` defaults to `false`, interactive prompts still work.

---

## stdout / stderr Separation

MCP protocol uses stdout for JSON messages. All `console.log` output from commands is redirected to `stderr` inside the MCP server so it doesn't corrupt the protocol stream. The tool result returned to the LLM is a clean structured string.

---

## Installation Flow

```bash
# 1. Install
npm install -g cortex-sync

# 2. Configure (CLI, one time)
cortex init

# 3. Set env var
export CORTEX_PASSPHRASE="your-passphrase"   # add to ~/.zshrc

# 4. Register MCP server in Claude Code
claude mcp add cortex -- cortex mcp

# 5. Use from Claude Code chat
# "sync my sessions" → calls sync tool
# "pull from github" → calls pull tool
```

MCP config written by `claude mcp add`:
```json
{
  "cortex": {
    "command": "cortex",
    "args": ["mcp"],
    "env": { "CORTEX_PASSPHRASE": "..." }
  }
}
```

---

## Tests

**New unit tests:**
- `tests/lib/passphrase.test.ts` — env var takes priority over interactive prompt
- `tests/commands/pull-noninteractive.test.ts` — unknown projects go to `pendingMappings`, not error

**Existing tests:** all pass without changes — CLI behavior is unchanged.

**Manual validation (post-implementation):**
```bash
npm install -g cortex-sync
cortex init
export CORTEX_PASSPHRASE="..."
cortex mcp          # verify starts without error
claude mcp add cortex -- cortex mcp
# test sync/pull/status/convert from Claude Code chat
```

---

## Out of Scope

- Google Drive backend (already out of scope for MVP)
- MCP resources or prompts (tools only)
- End-to-end MCP integration tests
