# Changelog

## [Unreleased]

### Security

- **Fixed a remote code execution vulnerability** in `cortex team init`/`push`/`pull` and `cortex install`. `repoUrl` — read from `cortex.json`, a committed and therefore untrusted file — was passed to `git clone`/`pull`/`push` as a bare positional argument. A `repoUrl` starting with `--upload-pack=<command>` was parsed by git as an option, not a URL, and the injected command ran before the clone failed. Verified against the pre-fix code with a working PoC, and against the real attack chain end-to-end (`cortex.json` with a malicious `repo` field → `cortex install`, exactly as the README instructs). Fixed with `assertSafeRepoUrl()` (repo URL must start with `https://`) plus defense in depth on every git invocation: a `--` separator before the URL and `-c protocol.ext.allow=never`. See `src/lib/team-repo.ts`.
- **Fixed a path traversal vulnerability** in `cortex pull`. CLAUDE.md, skills, and doc file paths came from the remote manifest — untrusted input, since it's controlled by whoever has write access to your personal storage backend or (in the team scenario) the shared team passphrase — and were joined onto the local project path without validation. A manifest entry like `docs/../../../../.bashrc` wrote outside the project. Fixed with a shared `safeJoin()` guard (`src/lib/safe-path.ts`), applied to skills, docs, and session file writes, consolidating a check that already existed independently in `LocalFilesystemBackend` and `ClaudeCodeAdapter` but was missing from the newer per-project sync/pull path.
- **Added `cortex sync --redact`**: scans collected files for API keys, tokens, and private keys before encrypting, and replaces each match with a `[REDACTED:<pattern>]` placeholder instead of only warning. Real npm-published packages have shipped Claude Code session files with live credentials — this makes it possible to sync a project without ever persisting a real secret, encrypted or not.
- Removed `authUrl()` — dead code that embedded the token directly in a git URL, contradicting this project's own documented invariant that the token must never appear in a URL.

### Changed — BREAKING

- `cortex sync`/`cortex pull`/`cortex status` are now **scoped to the current project directory**, the same way `cortex team` already is — instead of syncing all of `~/.claude/` from the whole machine. Run them from inside the project you want to sync; the project is identified the same way `cortex team` identifies it (git remote, first commit, or a `cortex.json` override).
- `cortex sync` now also carries `CLAUDE.md`, `.claude/skills/*.md`, and approved extra `.md` docs — not just session history — and restores them at the same relative path on `cortex pull`, matching what `cortex team push`/`pull` already do for a shared repo. Everything is still AES-256-GCM encrypted.
- Personal storage is now namespaced per project, so the same GitHub repo or local folder can be reused across multiple projects without one project's sync overwriting another's manifest.
- Removed the `--prune` flag from `cortex sync` — no longer needed now that each project has its own storage namespace.
- **No migration path**: backups made with cortex-sync 0.4.x under the old whole-machine layout are not readable by this version. Re-run `cortex sync` from each project you want synced going forward.

## [0.1.0] - 2026-05-12

First public release.

### Added

**Sync**
- `cortex init` — configure storage backend, encryption email, passphrase, detect installed tools
- `cortex sync` — encrypt `~/.claude/` with AES-256-GCM and upload to configured storage
- `cortex pull` — download, decrypt, and restore files with automatic path remapping
- `cortex status` — show diff between local and remote without downloading anything

**Encryption**
- AES-256-GCM with PBKDF2 key derivation (600,000 iterations, SHA-256)
- Email-as-salt — unique key per user without storing the key anywhere
- Versionated binary format (`CTXP` magic + version byte) for future migrations
- Secret detection before upload (AWS, GitHub, Anthropic, Stripe, Google API, Slack, PEM keys)

**Path remapping**
- Project identification via git remote URL (primary) or first commit hash (fallback)
- Manual override via `cortex.json` in project root
- Persistent mappings in `~/.cortex/path-mappings.json`
- JSONL rewriter: rewrites only structural path fields (`cwd`, `filePath`, `file_path`, `file.filePath`); historical content (stdout, text responses, commands) is never modified
- EOL byte preservation per line (LF and CRLF)

**Storage backends**
- GitHub private repo via Personal Access Token — no OAuth app registration needed
- Local filesystem — works transparently with Dropbox, iCloud Drive, Syncthing, or any shared folder

**Skill conversion**
- `cortex convert <file> --to antigravity` — converts to `.agent/skills/<name>/SKILL.md`
- `cortex convert <file> --to cursor` — appends/replaces a named section in `.cursorrules`
- `cortex convert <file> --to all` — both targets in one run
- Anthropic API key: reads from `ANTHROPIC_API_KEY` env, encrypted `~/.cortex/api-key.enc`, or interactive prompt
