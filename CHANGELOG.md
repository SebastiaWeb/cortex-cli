# Changelog

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
