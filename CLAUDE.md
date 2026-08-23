# cortex-cli — Context for Claude Code

## What this project is

CLI tool published as `cortex-sync` on npm. Syncs a project's Claude Code context (sessions, CLAUDE.md, skills, docs) between your own machines with AES-256-GCM encryption and automatic JSONL path remapping — **scoped to the current project directory**, the same way `cortex team` is. Also shares team context through a shared GitHub repo.

`cortex sync`/`pull`/`status` and `cortex team push`/`pull` move the same kind of content (sessions, CLAUDE.md, skills, docs); the difference is only the destination: `sync`/`pull` use your personal storage (GitHub private repo or local folder) with everything AES-256-GCM encrypted, `team` pushes to a shared git repo other people can read.

## Architecture

```
src/
  cli.ts                  ← entry point, Commander program
  commands/
    init.ts               ← personal storage setup
    sync.ts               ← collect this project's context, encrypt, upload (scoped to cwd)
    pull.ts               ← download + decrypt + remap + place into this project (scoped to cwd)
    status.ts             ← diff this project's local files vs remote
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
    project-identifier.ts ← identifyProject() (git remote / first commit / cortex.json),
                             resolveProjectKey() (stable storage namespace for sync/pull/status)
    project-content.ts    ← collectProjectFiles() (sessions+CLAUDE.md+skills for this project),
                             placeSessionFiles() (remap + write on pull)
    project-storage-paths.ts ← remote/local storage paths, namespaced per projectKey
    claude-skills.ts      ← read/write skills, findClaudeMd, findExtraMdFiles,
                             stripCortexPathBlock, injectCortexPathBlock
    team-sessions.ts      ← localSessionsDir(), readSessionFiles() — shared by sync and team
    team-repo.ts          ← git clone/pull/push via GIT_ASKPASS (token never in URLs)
    crypto.ts             ← AES-256-GCM encrypt/decrypt, PBKDF2 key derivation
    jsonl-remapper.ts     ← rewrite structural path fields in JSONL sessions
    manifest.ts           ← per-file checksums (SHA-256), diff logic
    config.ts             ← load/save ~/.cortex/config.json (personal storage, machine-wide)
    project-config.ts     ← load/save <cwd>/cortex.json (team repo URL, approved extra docs)
    conflict.ts           ← detect and resolve skill/CLAUDE.md conflicts
    secrets-detector.ts   ← scan files for API keys before encrypting
  storage/
    github.ts             ← GitHub REST API backend
    local.ts              ← local filesystem backend
  adapters/
    claude-code.ts        ← generic ~/.claude/ tree adapter (multi-tool skill conversion; not used by sync/pull/status)
```

## Key invariants — do not break these

### repoUrl is untrusted input — always call assertSafeRepoUrl() first
`repoUrl` comes from `cortex.json`, a committed file — anyone whose repo you clone controls it. Every exported function in `team-repo.ts` that spawns `git` (`cloneTeamRepo`, `pullTeamRepo`, `commitAndPush`) must call `assertSafeRepoUrl(repoUrl)` before doing anything else. Without it, a `repoUrl` like `--upload-pack=<shell command>` is parsed by git as an OPTION, not a URL — git runs the injected command before failing the clone. This was a real RCE (see CHANGELOG). Every `spawnSync('git', …)` call must also pass `--` before the URL and `-c protocol.ext.allow=never`, as defense in depth — validation should never be the only layer between untrusted input and `spawnSync`.

### Untrusted paths from a remote manifest — always call safeJoin()
File paths written during `cortex pull` (CLAUDE.md, skills, docs, sessions) come from the remote manifest, which is untrusted the same way `repoUrl` is (backend write access, or the shared team passphrase). Never `join(base, untrustedRelPath)` directly — use `safeJoin(base, untrustedRelPath)` from `src/lib/safe-path.ts`, which throws on any path that would escape `base`. This consolidates a check that used to exist only in `LocalFilesystemBackend.safePath` and `ClaudeCodeAdapter.putFiles` — the per-project `pull.ts`/`project-content.ts` path lost it during the sync/pull rescoping and had to have it restored.

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

### Per-project storage namespacing
`cortex sync`/`pull`/`status` are scoped to `resolveProjectKey(cwd)` (`project-identifier.ts`) — the same git-remote / first-commit / `cortex.json` identification `cortex team` already uses. Every remote path is namespaced under that key (`project-storage-paths.ts`): `manifest/<projectKey>.json.enc` and `files/projects/<projectKey>/<relPath>`. This is what makes it safe for multiple projects to share one personal backend (one GitHub repo or one Dropbox folder for everything) without one project's sync overwriting another's manifest — there is no cross-project guard to maintain because each project's data structurally cannot see another's.

### Checksum consistency
After remapping a JSONL file on pull, save the local manifest with the REMAPPED checksum (what's actually on disk), not the remote checksum. Otherwise every subsequent pull re-downloads unchanged files. Same rule for CLAUDE.md: checksum the pre-`injectCortexPathBlock` content (matching what the remote manifest stores), not the machine-specific block that gets written to disk.

### cortex-sync path block
`injectCortexPathBlock()` adds a machine-specific block to `.claude/CLAUDE.md` on `cortex pull`/`team pull`/`install`. This block MUST be stripped with `stripCortexPathBlock()` before CLAUDE.md is uploaded anywhere — `cortex sync` (via `collectProjectFiles()`) and `team push`/`init` both do this — it contains the local machine path and must never reach storage or the team repo.

## Build and publish

```bash
npm run build       # tsup → dist/cli.js
npm run typecheck   # tsc --noEmit
npm test            # vitest run (27 test files, ~158 tests)
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

### 8. cortex sync/pull synced the whole machine, not the project (breaking change)
Before this change, `cortex sync` walked all of `~/.claude/` (`ClaudeCodeAdapter`) and used a single machine-wide `manifest.json.enc` per personal backend. Two problems: it dumped every project's session history into one backup regardless of what you actually wanted synced, and if you used the same personal backend across multiple projects, the second project's sync would silently overwrite the first project's manifest (files stayed in storage but became invisible to `pull`/`status`). Fixed by scoping `sync`/`pull`/`status` to `resolveProjectKey(cwd)`, namespacing every remote path under `<projectKey>` (see "Per-project storage namespacing" above), and having `cortex sync` collect the same content `cortex team push` does (sessions, CLAUDE.md, skills, docs) instead of the raw `~/.claude/` tree. `resolveLocalPath()` and `path-mappings.ts` — built for resolving ambiguous multi-project remote manifests — were removed entirely: with one project per namespace there's no ambiguity to resolve, `pull` just uses `cwd`. `ClaudeCodeAdapter` is unused by sync/pull/status now (kept for the skill-conversion adapters). No migration path for old whole-machine backups.

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
| Global config (personal storage backend) | `~/.cortex/config.json` (mode 600) |
| Team repo clone | `~/.cortex/team/` |
| Project config | `<cwd>/cortex.json` |
| Local pull manifest (per project) | `~/.cortex/manifests/<projectKey>.json` |
| Remote manifest (per project) | `manifest/<projectKey>.json.enc` in personal storage |
| Remote project files | `files/projects/<projectKey>/{sessions,skills,docs}/...`, `files/projects/<projectKey>/CLAUDE.md` in personal storage |
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
- `sync-pull-roundtrip.test.ts` — A syncs a project (sessions+CLAUDE.md+skills+docs), B pulls and gets them remapped/placed; a second project on the same personal backend doesn't collide with the first
- `path-remap-roundtrip.test.ts` — `placeSessionFiles` remaps structural fields, preserves historical content
- `jsonl-remapper.test.ts` — structural fields rewritten, text untouched, non-object lines preserved
- `team-repo.test.ts` — PAT never appears in `.git/config` after clone
- `claude-skills.test.ts` — inject/strip cortex block round-trip
- `project-identifier.test.ts` — `resolveProjectKey` derives a storage-safe key, throws when no git/`cortex.json`
- `project-content.test.ts` — `collectProjectFiles` assembles sessions+CLAUDE.md+skills; `placeSessionFiles` remaps on write

## Plugin marketplace

Files for the Claude Code community plugin marketplace:
- `.claude-plugin/plugin.json` — manifest
- `.mcp.json` — MCP server config (`cortex mcp` command)

Validate with: `claude plugin validate .`
