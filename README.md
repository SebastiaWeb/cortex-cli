# cortex

**Sync Claude Code sessions between machines with automatic path remapping.**

Claude Code stores your session history in `~/.claude/projects/` using absolute paths. Switch from your Mac to a Linux server and those sessions are gone — the paths don't match. `cortex` fixes that.

```bash
npm install -g cortex-sync
```

---

## How it works

```
Machine A (Mac)                        Machine B (Linux)
─────────────────────────              ──────────────────────────────
~/.claude/projects/                    ~/.claude/projects/
  -Users-alice-myapp/                    -home-alice-work-myapp/
    abc123.jsonl                           abc123.jsonl
    cwd: /Users/alice/myapp   ──────▶      cwd: /home/alice/work/myapp
                               cortex        ↑ paths remapped automatically
                            sync → pull
```

`cortex` identifies your project by its git remote URL (or first commit hash), maps it to the correct path on each machine, and rewrites only the structural path fields inside each JSONL session file — without touching your conversation history.

---

## Quick start

```bash
# 1. Install
npm install -g cortex-sync

# 2. Configure on Machine A
cortex init
#  → pick GitHub (PAT) or a local folder (Dropbox / iCloud / Syncthing)
#  → set your encryption passphrase (never stored)

# 3. Push your sessions
cortex sync

# 4. On Machine B — pull and start working
cortex init   # same storage, same passphrase
cortex pull   # downloads, decrypts, remaps paths automatically
```

Open any project on Machine B — Claude Code shows your full session history.

---

## Commands

| Command | What it does |
|---|---|
| `cortex init` | Configure storage, email, and passphrase |
| `cortex sync` | Encrypt `~/.claude/` and upload |
| `cortex pull` | Download, decrypt, remap paths |
| `cortex status` | Show what's out of sync (no download) |
| `cortex convert <file> --to <target>` | Convert a Claude Code skill |
| `cortex setup-mcp` | Register cortex as a Claude Code MCP server |

---

## Claude Code MCP integration

Use `sync`, `pull`, `status`, `convert`, and `init` directly from the Claude Code chat — one command does everything:

```bash
npm install -g cortex-sync
cortex init       # configure storage and passphrase
cortex setup-mcp  # registers cortex in Claude Code automatically
```

That's it. Restart Claude Code and you're done.

### What setup-mcp does

`cortex setup-mcp` detects the binary path, prompts for your passphrase once, and runs `claude mcp add` with the correct arguments — no manual PATH configuration needed.

### Available MCP tools

| Tool | What it does |
|---|---|
| `sync` | Encrypt and upload `~/.claude/` |
| `pull` | Download, decrypt, remap paths |
| `status` | Show what's out of sync |
| `convert` | Convert a skill to Antigravity or Cursor |
| `init` | Configure storage (non-interactive) |

### Environment variables (advanced / manual setup)

| Variable | Required for |
|---|---|
| `CORTEX_PASSPHRASE` | `sync`, `pull`, `status` |
| `ANTHROPIC_API_KEY` | `convert` |
| `CORTEX_GITHUB_TOKEN` | `init` with GitHub storage |

---

## Storage backends

### GitHub private repo (recommended)

No OAuth app needed — just a Personal Access Token.

```bash
cortex init
# Select "GitHub private repo"
# → Create a PAT at: github.com/settings/tokens/new?scopes=repo
# → Paste the token (ghp_...)
# → cortex validates it and creates the private repo automatically
```

### Local folder

Works with Dropbox, iCloud Drive, Syncthing, NFS, or any shared directory.

```bash
cortex init
# Select "Local folder"
# → Enter path: ~/Dropbox/cortex-backup
```

---

## Skill conversion

Convert Claude Code skills to other AI tool formats using your own Anthropic API key.

```bash
# To Antigravity  →  .agent/skills/<name>/SKILL.md
cortex convert ~/.claude/skills/tdd.md --to antigravity --output-dir ./my-project

# To Cursor  →  .cursorrules (intelligent append, no duplicates across runs)
cortex convert ~/.claude/skills/tdd.md --to cursor --output-dir ./my-project

# Both at once
cortex convert ~/.claude/skills/tdd.md --to all --output-dir ./my-project
```

API key priority: `ANTHROPIC_API_KEY` env → `~/.cortex/api-key.enc` (encrypted) → interactive prompt.

---

## Security

Everything is encrypted **before** leaving your machine. Your storage provider sees only ciphertext.

| What | How |
|---|---|
| Encryption | AES-256-GCM (authenticated) |
| Key derivation | PBKDF2, 600,000 iterations, SHA-256 |
| Salt | SHA-256(lowercase(your email)) |
| Passphrase | Never stored anywhere — derived fresh each session |
| Secret detection | Warns before encrypting if API keys or PEM keys are found in your files |

The GitHub PAT is stored in `~/.cortex/config.json` (your machine, your user). The Anthropic API key — if you choose to save it — goes to `~/.cortex/api-key.enc`, encrypted with your sync passphrase.

---

## How path remapping works

Claude Code encodes project paths into directory names by replacing every non-alphanumeric character with `-`:

```
/home/alice/work/myapp  →  -home-alice-work-myapp
```

This encoding is **lossy** — it cannot be reversed. `cortex` reads the `cwd` field inside each JSONL session file, which holds the original absolute path, and uses that as the source of truth.

On `cortex pull`, for each project:

1. Reads `cwd` from the session JSONL to get the original path
2. Identifies the project via `git remote.origin.url` or `git rev-list --max-parents=0 HEAD`
3. Looks up your local path in `~/.cortex/path-mappings.json` (prompts once if unknown)
4. Rewrites only the 4 structural fields per line: `cwd`, `filePath`, `file_path`, `file.filePath`
5. Renames `~/.claude/projects/<old-encoded>/` → `<new-encoded>/`

Conversation history, command outputs, and text responses are **never modified**.

For projects without git, drop a `cortex.json` in the project root:

```json
{ "projectId": "my-unique-id" }
```

---

## Requirements

- Node.js ≥ 20
- Claude Code installed on each machine you want to sync

---

## License

[AGPL-3.0](LICENSE) — free to use, modify, and distribute. Forks used to run a hosted service must publish their source changes.
