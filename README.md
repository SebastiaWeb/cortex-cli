# cortex

**Share Claude Code context with your team. Sync your sessions between machines.**

```bash
npm install -g cortex-sync
```

Works on **Linux**, **macOS**, and **Windows**.

![cortex demo](https://raw.githubusercontent.com/SebastiaWeb/cortex-cli/main/demo/demo.gif)

---

## What cortex does

cortex has two independent features:

| Feature | What it does | Scope |
|---|---|---|
| `cortex team` | Share skills, CLAUDE.md, docs, and sessions with your team via a GitHub repo | Per-project |
| `cortex sync / pull` | Encrypt and sync **all** `~/.claude/` sessions across your own machines | Whole machine |

**Start with `cortex team`** if you want Claude Code to know your project context and share it with teammates. Use `cortex sync / pull` if you work across multiple machines and want your personal session history everywhere.

---

## cortex team — share project context with your team

Share skills, CLAUDE.md, documentation, and Claude Code sessions through a shared GitHub repo. Each developer gets the full team context installed automatically.

![cortex team demo](https://raw.githubusercontent.com/SebastiaWeb/cortex-cli/main/demo/demo-team.gif)

### Tech Lead — one-time setup

```bash
cd your-project/

# Initialize the shared team repo
cortex team init --repo https://github.com/your-org/claude-config
```

During init you are asked:
- Which `.md` files to include (CLAUDE.md is picked up automatically from root or `.claude/`)
- Whether to share Claude Code sessions with the team
- Whether to encrypt them (AES-256-GCM, recommended)

```bash
# Push updated context any time
cortex team push
```

`cortex team push` scans your project for:
- `CLAUDE.md` — at project root or `.claude/CLAUDE.md`
- `.claude/skills/*.md` — all your Claude Code skills
- Any other `.md` files found (you are asked whether to include them)

### Dev — first-time install

```bash
cd your-project/

cortex install --repo https://github.com/your-org/claude-config
```

This single command installs everything:
- Skills → `.claude/skills/`
- CLAUDE.md → `.claude/CLAUDE.md`
- Shared docs → project root (same paths as the original)
- Required Claude plugins
- Team sessions (paths remapped to your machine automatically)

Restart Claude Code after running. That's it.

### Day-to-day

```bash
# Pull latest skills, docs, and sessions from teammates
cortex team pull

# Push your updated sessions and context to the team
cortex team push
```

### What gets shared

| What | Where it comes from | Where it lands |
|---|---|---|
| CLAUDE.md | Project root or `.claude/CLAUDE.md` | `.claude/CLAUDE.md` on each machine |
| Skills | `.claude/skills/*.md` | `.claude/skills/` on each machine |
| Extra docs | Any `.md` you approve at push time | Same relative path on each machine |
| Plugins | Installed Claude plugins | Auto-installed via `cortex.json` |
| Sessions (opt-in) | `~/.claude/projects/<this-project>/` | Paths remapped automatically per machine |

### Session encryption

Sessions are encrypted with AES-256-GCM using a shared team passphrase. The passphrase is **never stored** — share it via a password manager. Everyone with the passphrase can decrypt each other's sessions.

> **Privacy:** Sessions may contain source code, API calls, and sensitive context. Only opt in if your team has a shared understanding that sessions are visible to all members.

---

## cortex sync / pull — sync your sessions across your own machines

`~/.claude/projects/` uses absolute paths. Switch from your Mac to a Linux server and Claude Code can't find your sessions — the paths don't match. `cortex sync / pull` fixes that.

> **Note:** `cortex sync` encrypts and uploads **everything** in `~/.claude/` — all projects, all sessions, from the whole machine. It is not scoped to a single project.

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

### Setup

```bash
# Machine A
cortex init        # pick GitHub repo or local folder (Dropbox / iCloud / Syncthing)
cortex sync        # encrypt and upload all ~/.claude/

# Machine B
cortex init        # same storage, same passphrase
cortex pull        # download, decrypt, remap paths
```

Open any project on Machine B — Claude Code shows your full session history.

### Update your token

```bash
cortex set-token ghp_your_new_token
```

Updates the stored GitHub PAT without re-running `cortex init`.

---

## Commands

| Command | What it does |
|---|---|
| `cortex team init` | Initialize team repo, upload context, set session sharing preference |
| `cortex team push` | Push skills, CLAUDE.md, docs, and sessions to team repo |
| `cortex team pull` | Pull team context and sessions, with conflict resolution |
| `cortex install` | First-time install from team repo (skills + sessions + docs) |
| `cortex init` | Configure personal storage, email, and passphrase |
| `cortex sync` | Encrypt all `~/.claude/` and upload to personal storage |
| `cortex pull` | Download, decrypt, and remap paths from personal storage |
| `cortex status` | Show what's out of sync (no download) |
| `cortex set-token <token>` | Update GitHub PAT without reconfiguring everything |
| `cortex convert <file> --to <target>` | Convert a Claude Code skill to Antigravity or Cursor format |
| `cortex setup-mcp` | Register cortex as a Claude Code MCP server |

---

## Claude Code MCP integration

Use cortex directly from the Claude Code chat:

```bash
cortex setup-mcp
```

Restart Claude Code and the following tools become available:

| Tool | What it does |
|---|---|
| `sync` | Encrypt and upload `~/.claude/` |
| `pull` | Download, decrypt, remap paths |
| `status` | Show what's out of sync |
| `convert` | Convert a skill to Antigravity or Cursor |
| `init` | Configure storage (non-interactive) |

### Environment variables for MCP

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
| GitHub token | Passed via `GIT_ASKPASS` temp script — never embedded in URLs or git config |
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

---

## Requirements

- Node.js ≥ 20
- Claude Code installed on each machine

---

## License

[AGPL-3.0](LICENSE) — free to use, modify, and distribute. Forks used to run a hosted service must publish their source changes.
