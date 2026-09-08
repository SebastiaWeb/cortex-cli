# Changelog

## [0.6.0] - 2026-09-07

### Security

- **Encryption is now bound to storage path (AAD).** `encrypt()`/`decrypt()` (`src/lib/crypto.ts`) take the destination path as AES-GCM additional authenticated data. A ciphertext moved or swapped between paths — e.g. two projects sharing a backend, or a manifest entry pointed at the wrong blob — now fails to decrypt instead of silently returning bytes that don't belong there.
- **Random per-project salt, not `SHA256(email)`.** Key derivation used the same deterministic salt every sync — anyone who knew (or guessed) your email could precompute it. `getOrCreateSalt()` (`src/lib/project-salt.ts`) now generates a random 16-byte salt on first sync and stores it unencrypted next to the manifest (`manifest/<projectKey>.salt`); it isn't secret, it just has to be shared so every machine derives the same key from the same passphrase. `deriveKeyFromSalt()` replaces the old email-only `deriveKey()` call in `sync`/`pull`/`status`.
- **`cortex rekey`**: rotates a project's salt and re-encrypts every file under the new derived key, in one atomic batch write (`writeMany`). Re-encryption happens at the compressed-ciphertext layer — decrypt with the old key, encrypt the same bytes with the new one — so plaintext is never touched. Use it if you suspect your passphrase or backend has been exposed.
- **`cortex sync --strict`**: refuses to sync (throws) if the secrets scanner finds anything, instead of just warning. Combine with `--redact` to scrub first and sync anyway.
- **`ensureGitHubRepo` now checks visibility before treating "repo already exists" as success.** Creating a repo returns 422 if one with that name already exists — the old code treated any 422 as fine. If that existing repo turns out to be public, `cortex init`/`sync` now throws instead of uploading encrypted backups to it: ciphertext stays opaque, but file names, project structure, and timestamps would still be exposed.
- Fixed `cortex status`: it was never updated to `decompress()` remote manifests when compression was added in 0.5.1, so it would have thrown a JSON parse error on gzip bytes the first time anyone ran it against a real backend.
- **No migration path**: a remote synced under 0.5.x used `SHA256(email)` as the salt and no AAD. This version generates a random salt on first contact with a project and derives a different key from it, so it cannot decrypt a pre-0.6.0 remote — `cortex pull`/`status` fail with a raw `Unsupported state or unable to authenticate data` from Node's crypto module (verified against a real pre-0.6.0-shaped remote), not a clear "please re-sync" message. Run `cortex sync` from your main machine after upgrading, before pulling from any other machine.

## [0.5.1] - 2026-08-30

### Fixed

- **The GitHub backend now works with sessions over 1MB.** `cortex sync`/`pull`/`status` previously used the Contents API, which omits the `content` field entirely for files over 1MB — `cortex pull`/`status` silently failed or corrupted state for any session that size. On this machine, 7 of 16 real sessions were already over the limit (largest: 46MB). Fixed by moving reads and writes to the Git Data API (blobs + trees + commits) instead of the Contents API. `GitHubBackend.read()` now fetches by blob sha (`GET /git/blobs/{sha}`), which has no such limit.
- **`cortex sync` now uploads as one commit per run** (two if there are deletions), not one commit per changed file. `write`/`remove` are now batched through new `writeMany`/`removeMany` methods on `IStorageBackend` — a single blob/tree/commit/ref-update sequence for the whole batch, instead of a separate Contents-API PUT (and commit) per file.
- **Content is now gzip-compressed before encryption** (`src/lib/compress.ts`) on both backends. JSONL sessions are highly repetitive and typically compress 10:1+ — smaller uploads, and fewer files anywhere near a size limit to begin with.
- Not changed: `GitHubBackend.list()`'s `truncated` tree-pagination gap noted in the roadmap turned out to be dead code — nothing in `sync`/`pull`/`status` actually calls `list()` (they address files directly by known manifest paths). Left as-is rather than building pagination for a method nothing uses.
- **No migration path**: existing remote manifests/files from 0.5.0 are plaintext-after-decrypt (uncompressed); this version expects gzip-compressed content after decrypt. Re-run `cortex sync` from each project after upgrading.

## [0.5.0] - 2026-08-30

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
