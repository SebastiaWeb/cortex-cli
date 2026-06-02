# cortex-sync — Project Context

## What this is

`cortex-sync` is a CLI tool (`npm install -g cortex-sync`) that:
1. **Syncs Claude Code sessions** between machines with automatic path remapping
2. **Shares team context** (skills, CLAUDE.md, plugins, sessions) via a shared GitHub repo

Published on npm as `cortex-sync`, binary name is `cortex`.

## Tech stack

- **Language:** TypeScript (strict), ESM only
- **Build:** `tsup` → `dist/cli.js` (single bundle)
- **Tests:** `vitest` — run with `npm test`
- **Type check:** `npx tsc --noEmit`
- **Node:** ≥ 20

## Project structure

```
src/
  cli.ts                        # Commander entrypoint, all command wiring
  commands/
    init.ts                     # cortex init — configure storage + passphrase
    sync.ts                     # cortex sync — encrypt + upload ~/.claude/
    pull.ts                     # cortex pull — download + decrypt + remap paths
    status.ts                   # cortex status — diff local vs remote
    convert.ts                  # cortex convert — skill format conversion
    setup-mcp.ts                # cortex setup-mcp — register MCP server
    install.ts                  # cortex install — first-time team install (skills + sessions)
    team/
      init.ts                   # cortex team init — init team repo + consent prompts
      push.ts                   # cortex team push — push skills + sessions to team repo
      pull.ts                   # cortex team pull — pull skills + sessions from team repo
  lib/
    config.ts                   # Load ~/.cortex/config.json (global user config)
    project-config.ts           # Read/write cortex.json (per-project config)
    crypto.ts                   # AES-256-GCM encrypt/decrypt + PBKDF2 key derivation
    team-repo.ts                # git clone/pull/push team repo via embedded token
    team-sessions.ts            # Session push/pull/remap logic
    jsonl-remapper.ts           # Rewrite cwd/filePath fields in JSONL session files
    project-identifier.ts       # Stable project ID: git remote → first commit → cortex.json
    path-encoder.ts             # Replicate Claude Code's lossy path encoding
    claude-skills.ts            # Read/write .claude/skills/ and .claude/CLAUDE.md
    claude-plugins.ts           # Install/list Claude Code plugins
    conflict.ts                 # Conflict detection + resolution prompts
    passphrase.ts               # Read passphrase from env or interactive prompt
  storage/
    github.ts                   # GitHub API: create repo, upload/download blobs
  adapters/
    paths.ts                    # Resolve tool paths (claude-code, cursor, antigravity)
    types.ts                    # SupportedTool type
scripts/
  postinstall.cjs               # Cross-platform PATH fix after npm install -g
tests/
  lib/                          # Unit tests mirror src/lib/
```

## Key files to know

| File | Purpose |
|---|---|
| `~/.cortex/config.json` | Global user config: email, githubToken, storage backend |
| `cortex.json` (project root) | Per-project: `repo`, `shareSession`, `encryptSessions`, `projectId` |
| `~/.cortex/team/` | Local clone of the team GitHub repo |
| `~/.claude/projects/<encoded>/` | Claude Code session JSONL files |

## cortex.json fields

```json
{
  "repo": "https://github.com/org/claude-config",
  "shareSession": true,
  "encryptSessions": true,
  "projectId": "optional-override"
}
```

`projectId` is auto-derived from git remote URL. For non-git projects, `cortex team init` uses the team repo URL as the projectId so all devs share the same identifier automatically.

## Session sharing design

- Sessions stored in team repo at: `sessions/<email>/<projectId>/`
- `projectId` = team repo URL (ensures all devs use the same key regardless of local paths)
- Encryption: `deriveKey(teamPassphrase, repoUrl)` — same salt = same key for all devs
- On pull: `extractCwdFromJsonl` reads original path, `remapJsonlBuffer` rewrites paths to local machine
- `.jsonl.enc` = encrypted, `.jsonl` = plain

## Conventions

- No `any` — use `unknown` and narrow
- All lib functions are named exports, no default exports
- `node:` prefix on all Node.js built-ins
- Tests in `tests/lib/<name>.test.ts` mirror `src/lib/<name>.ts`
- Never store passphrases — derive fresh each session
- `commitAndPush` embeds GitHub token in URL: `https://<token>@github.com/...`

## Commands to run

```bash
npm test              # run all tests
npm run build         # build dist/cli.js
npx tsc --noEmit      # type check only
node dist/cli.js --help
```

## Current version

`0.4.16` — published on npm as `cortex-sync`

## Demo assets

- `demo/demo.gif` — main demo GIF (personal sync flow)
- TODO: team sessions demos (vhs scripts in `demo/`)
