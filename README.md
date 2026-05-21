# cortex

**Sync Claude Code sessions between machines. Share team context automatically.**

Claude Code stores your session history in `~/.claude/projects/` using absolute paths. Switch from your Mac to a Linux server and those sessions are gone — the paths don't match. `cortex` fixes that, and also lets your whole team share sessions, skills, and context through a shared GitHub repo.

```bash
npm install -g cortex-sync
```

Works on **Linux**, **macOS**, and **Windows**. The `cortex` command is available immediately after install — no shell restart needed.

![cortex demo](https://raw.githubusercontent.com/SebastiaWeb/cortex-cli/main/demo/demo.gif)

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

## Quick start — personal sync

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

## Team context sharing

Share skills, CLAUDE.md, plugins, and chat sessions with your whole team through a shared GitHub repo.

![cortex team demo](https://raw.githubusercontent.com/SebastiaWeb/cortex-cli/main/demo/demo-team.gif)

### Tech Lead — one-time setup

```bash
cd your-project/

# Initialize the team repo and optionally share your sessions
cortex team init --repo https://github.com/your-org/claude-config

# Push updated context anytime
cortex team push
```

During `cortex team init` you are asked once:
- **Share sessions?** — whether to share your Claude Code sessions with the team
- **Encrypt?** — whether to encrypt them (AES-256-GCM, recommended)

If you choose to share, sessions are uploaded on every `cortex team push`.

### Dev — first-time install

```bash
cd your-project/

cortex install --repo https://github.com/your-org/claude-config
```

This single command:
- Installs team skills into `.claude/skills/`
- Installs team `CLAUDE.md`
- Installs required Claude plugins
- Downloads and installs all team sessions (paths remapped to your machine automatically)

Claude Code shows all team sessions natively — no extra steps. Restart Claude Code after running.

### Day-to-day

```bash
# Pull latest team context + new sessions from teammates
cortex team pull

# Push your updated sessions to the team
cortex team push
```

### What gets shared

| What | Source | Destination |
|---|---|---|
| Skills | `.claude/skills/*.md` | `skills/` in team repo |
| CLAUDE.md | `.claude/CLAUDE.md` | `CLAUDE.md` in team repo |
| Plugins | Installed Claude plugins | `cortex.json → plugins[]` |
| Sessions (opt-in) | `~/.claude/projects/<project>/` | `sessions/<email>/<project-id>/` |

### Session encryption

Sessions are encrypted with AES-256-GCM using a shared team passphrase. The passphrase is **never stored** — share it with teammates via a password manager. Everyone with the passphrase can decrypt each other's sessions.

**Two machines, same GitHub user:** Each machine generates unique session IDs, so pushing from two machines never creates duplicates.

> **Privacy:** Sessions may contain source code, API calls, and sensitive context. Only opt in if your team has a shared understanding that sessions are visible to all members.

---

## Commands

| Command | What it does |
|---|---|
| `cortex init` | Configure storage, email, and passphrase |
| `cortex sync` | Encrypt `~/.claude/` and upload |
| `cortex pull` | Download, decrypt, remap paths |
| `cortex status` | Show what's out of sync (no download) |
| `cortex team init` | Initialize team repo and set session sharing preference |
| `cortex team push` | Push skills, CLAUDE.md, and sessions to team repo |
| `cortex team pull` | Pull team context and sessions from repo |
| `cortex install` | First-time install from team repo (skills + sessions) |
| `cortex convert <file> --to <target>` | Convert a Claude Code skill |
| `cortex setup-mcp` | Register cortex as a Claude Code MCP server |

---

## Claude Code MCP integration

Use `sync`, `pull`, `status`, `convert`, and `init` directly from the Claude Code chat:

```bash
cortex setup-mcp  # registers cortex in Claude Code automatically
```

Restart Claude Code and you're done.

### Available MCP tools

| Tool | What it does |
|---|---|
| `sync` | Encrypt and upload `~/.claude/` |
| `pull` | Download, decrypt, remap paths |
| `status` | Show what's out of sync |
| `convert` | Convert a skill to Antigravity or Cursor |
| `init` | Configure storage (non-interactive) |

### Environment variables

| Variable | Required for |
|---|---|
| `CORTEX_PASSPHRASE` | `sync`, `pull`, `status` |
| `ANTHROPIC_API_KEY` | `convert` |
| `CORTEX_GITHUB_TOKEN` | `init` with GitHub storage |

---

## Storage backends

### GitHub private repo (recommended)

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

Convert Claude Code skills to other AI tool formats.

```bash
# To Antigravity  →  .agent/skills/<name>/SKILL.md
cortex convert ~/.claude/skills/tdd.md --to antigravity --output-dir ./my-project

# To Cursor  →  .cursorrules
cortex convert ~/.claude/skills/tdd.md --to cursor --output-dir ./my-project

# Both at once
cortex convert ~/.claude/skills/tdd.md --to all --output-dir ./my-project
```

---

## Security

Everything is encrypted **before** leaving your machine.

| What | How |
|---|---|
| Encryption | AES-256-GCM (authenticated) |
| Key derivation | PBKDF2, 600,000 iterations, SHA-256 |
| Salt | SHA-256(lowercase(your email)) |
| Passphrase | Never stored anywhere — derived fresh each session |
| Team sessions | Encrypted with shared passphrase, salt = team repo URL |

---

## How path remapping works

Claude Code encodes project paths by replacing every non-alphanumeric character with `-`:

```
/home/alice/work/myapp  →  -home-alice-work-myapp
```

On `cortex pull` or `cortex team pull`, for each session:

1. Reads `cwd` from the JSONL to get the original path
2. Identifies the project via `git remote.origin.url` or first commit hash
3. Rewrites only the 4 structural fields per line: `cwd`, `filePath`, `file_path`, `file.filePath`

Conversation history and text responses are **never modified**.

For projects without git, `cortex` automatically assigns a stable project ID on first `cortex team init` or `cortex team push`.

---

## Requirements

- Node.js ≥ 20
- Claude Code installed on each machine

---

## License

[AGPL-3.0](LICENSE) — free to use, modify, and distribute. Forks used to run a hosted service must publish their source changes.
