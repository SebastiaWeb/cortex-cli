# cortex-cli — Context for Claude Code

## What this project is

CLI tool published as `cortex-sync` on npm. Syncs Claude Code sessions (`~/.claude/`) between machines with AES-256-GCM encryption and automatic JSONL path remapping. Also shares team context (skills, CLAUDE.md, docs, sessions) through a shared GitHub repo.

## Architecture

```
src/
  cli.ts                  ← entry point, Commander program
  commands/
    init.ts               ← personal storage setup
    sync.ts               ← encrypt + upload ~/.claude/
    pull.ts               ← download + decrypt + remap paths
    status.ts             ← diff local vs remote
    set-token.ts          ← update GitHub PAT without full init
    install.ts            ← first-time team context install
    mcp.ts                ← MCP server (tools: sync, pull, status, convert, init)
    setup-mcp.ts          ← registers cortex as Claude Code MCP server
    convert.ts            ← convert skills to Antigravity/Cursor format
    team/
      init.ts             ← initialize team repo, set session sharing
      push.ts             ← push skills/CLAUDE.md/docs/sessions to team repo
      pull.ts             ← pull team context with conflict resolution
  lib/
    claude-skills.ts      ← read/write skills, findClaudeMd, findExtraMdFiles,
                             stripCortexPathBlock, injectCortexPathBlock
    team-repo.ts          ← git clone/pull/push via GIT_ASKPASS (token never in URLs)
    crypto.ts             ← AES-256-GCM encrypt/decrypt, PBKDF2 key derivation
    jsonl-remapper.ts     ← rewrite structural path fields in JSONL sessions
    manifest.ts           ← per-file checksums (SHA-256), diff logic
    config.ts             ← load/save ~/.cortex/config.json
    project-config.ts     ← load/save <cwd>/cortex.json (team repo URL, session sharing)
    conflict.ts           ← detect and resolve skill/CLAUDE.md conflicts
    secrets-detector.ts   ← scan files for API keys before encrypting
  storage/
    github.ts             ← GitHub REST API backend
    local.ts              ← local filesystem backend
  adapters/
    claude-code.ts        ← read/write ~/.claude/ structure
```

## Key invariants — do not break these

### GIT_ASKPASS — token security
The GitHub PAT is NEVER embedded in git URLs. Always use `withAskpass(token, fn)` in `team-repo.ts`. This creates a temp shell script (mode 700, deleted in `finally`) that git calls for credentials. The token never appears in `.git/config`, `FETCH_HEAD`, or any git-tracked file.

```typescript
// CORRECT
withAskpass(token, (env) => {
  spawnSync('git', ['clone', repoUrl, dir], { stdio: 'pipe', env });
});

// NEVER DO THIS
spawnSync('git', ['clone', `https://${token}@github.com/...`, dir]);
```

### JSONL path remapping
Only rewrite these 4 structural fields per line — never touch conversation text:
- `cwd`
- `toolUseResult.filePath`
- `toolUseResult.file.filePath`
- `message.content[].input.file_path`

Non-object JSON lines (strings, arrays, null) must pass through byte-for-byte unchanged. Track whether a line was actually changed with a boolean — if unchanged, use the original bytes to avoid checksum drift from JSON.stringify whitespace normalization.

### Bidirectional sync guard
When syncing, never delete remote files from project directories that don't exist locally — they belong to other machines. Only delete if `localProjectDirs.has(projectDir)` OR `--prune` flag is set.

```typescript
for (const path of diff.removed) {
  const pm = path.match(/^projects\/([^/]+)\//);
  if (!opts.prune && pm && !localProjectDirs.has(pm[1])) continue;
  await backend.remove('files/' + path);
}
```

### Checksum consistency
After remapping a JSONL file on pull, save the manifest with the REMAPPED checksum (what's actually on disk), not the remote checksum. Otherwise every subsequent pull re-downloads unchanged files.

### cortex-sync path block
`injectCortexPathBlock()` adds a machine-specific block to `.claude/CLAUDE.md` on pull/install. This block MUST be stripped with `stripCortexPathBlock()` before pushing CLAUDE.md to the team repo — it contains the local machine path and must never reach the remote.

## Build and publish

```bash
npm run build       # tsup → dist/cli.js
npm run typecheck   # tsc --noEmit
npm test            # vitest run (22 test files, ~132 tests)
npm version patch   # bump version
npm publish         # runs prepublishOnly → build automatically before packaging
```

**Critical**: `prepublishOnly: "npm run build"` is in package.json. Never remove it. Before this was added, all versions from 0.4.19 to 0.4.21 shipped a stale binary from June 1st — none of the new features actually worked.

Always install with `@latest` to bypass npm cache:
```bash
npm install -g cortex-sync@latest
```

## Errors committed in the past — never repeat

### 1. Publishing stale dist
`npm publish` without a `prepublishOnly` build step ships whatever `dist/` has at that moment. Features written in TypeScript never reached users. Fixed by adding `"prepublishOnly": "npm run build"` to scripts.

### 2. Hardcoded CLAUDE.md path
`LOCAL_CLAUDE_MD = join(process.cwd(), '.claude', 'CLAUDE.md')` was the only location checked. If the user had `CLAUDE.md` at the project root (common), it was silently ignored. Fixed with `findClaudeMd()` which checks `.claude/CLAUDE.md` first, then root `CLAUDE.md`.

### 3. cortex-sync block polluting the team repo
`injectCortexPathBlock` writes the local machine path into `.claude/CLAUDE.md`. When `team push` read that file and uploaded it, every team member received the pushing machine's absolute path. Fixed with `stripCortexPathBlock()` in push/init before writing to TEAM_DIR.

### 4. checkbox UX silently discarded files
Using `@inquirer/prompts` `checkbox` with `checked: false` (default): user presses Enter → empty selection → nothing uploaded → appeared as if no files were found. Fixed by changing to `confirm` with a pre-printed file list. The user sees the files, answers yes/no.

### 5. Token in git URLs
Old code used `authUrl()` to embed the PAT as `https://token@github.com/...`. This caused `fatal: could not read Password` errors on machines where git had terminal prompts disabled, AND left the token in `FETCH_HEAD`. Fixed with `withAskpass()`.

### 6. Non-object JSONL lines throwing
`remapJsonlBuffer` parsed every line as JSON and assumed it was an object. Claude Code control lines can emit JSON strings, arrays, or null. These now pass through unchanged via:
```typescript
if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
  // remap
} else {
  parts.push(lineBytes); // pass through
}
```

### 7. Missing token in team pull/push
`pullTeamRepo()` was called without the token argument in `team/pull.ts` and `team/push.ts` in some commands. Always pass `config.githubToken` explicitly.

## Auth error messages

When git operations fail with auth errors, `throwGitError()` in `team-repo.ts` detects the pattern and shows:
```
GitHub authentication failed during git <op>.
Your token may be expired or revoked.
Update it with: cortex set-token <new-token>
```

Patterns detected: `authentication failed`, `could not read (username|password)`, `403`, `bad credentials`, `invalid username`.

## File locations

| What | Path |
|---|---|
| Global config | `~/.cortex/config.json` (mode 600) |
| Team repo clone | `~/.cortex/team/` |
| Project config | `<cwd>/cortex.json` |
| Encrypted manifest | `manifest.json.enc` in storage |
| Encrypted sessions | `files/projects/<encoded-path>/<session>.jsonl` in storage |
| Team skills | `~/.cortex/team/skills/*.md` |
| Team extra docs | `~/.cortex/team/docs/<relPath>` |

## findExtraMdFiles scope

Scans for extra `.md` files to optionally share with the team:
- Level 1: `<cwd>/*.md` (excluding `CLAUDE.md`)
- Level 2: `<cwd>/<dir>/*.md` (non-hidden, non-blacklisted dirs)
- `.claude/` internals: `<cwd>/.claude/**/*.md` (excluding `CLAUDE.md` and `skills/`)

Blacklisted dirs: `node_modules`, `.git`, `dist`, `build`, `.next`, `.nuxt`, `coverage`, `.cache`, `vendor`, `tmp`, `out`, `.turbo`.

On the destination machine, files land at the same relative path as the source (project root files → project root, `.claude/` files → `.claude/`). The `docs/` prefix in the team repo is internal only.

## Testing

```bash
npm test                          # all tests
npm test -- tests/lib/crypto      # specific file
```

Test structure mirrors `src/`. Integration tests in `tests/integration/`. Fixtures in `tests/fixtures/`.

Key test scenarios:
- `sync-pull-roundtrip.test.ts` — A→sync, B→pull+remap, B→sync: A's sessions survive
- `jsonl-remapper.test.ts` — structural fields rewritten, text untouched, non-object lines preserved
- `team-repo.test.ts` — PAT never appears in `.git/config` after clone
- `claude-skills.test.ts` — inject/strip cortex block round-trip

## Plugin marketplace

Files for the Claude Code community plugin marketplace:
- `.claude-plugin/plugin.json` — manifest
- `.mcp.json` — MCP server config (`cortex mcp` command)

Validate with: `claude plugin validate .`
