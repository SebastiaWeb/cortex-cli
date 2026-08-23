# cortex

**Share Claude Code context with your team. Sync your sessions between machines.**

```bash
npm install -g cortex-sync@latest
```

Works on **Linux**, **macOS**, and **Windows**.

![cortex demo](https://raw.githubusercontent.com/SebastiaWeb/cortex-cli/main/demo/demo.gif)

---

## What cortex does

cortex has two features that move the same kind of content — sessions, CLAUDE.md, skills, docs — to a different destination, both **scoped to the current project directory**:

| Feature | Destination | Encryption |
|---|---|---|
| `cortex team` | A shared GitHub repo other people can read | Sessions optional; CLAUDE.md/skills/docs plaintext |
| `cortex sync / pull` | Your own personal storage (private GitHub repo or local folder) | Everything, always (AES-256-GCM) |

**Start with `cortex team`** if you want Claude Code to know your project context and share it with teammates. Use `cortex sync / pull` if you just want your own project context (and history) to follow you across your own machines, encrypted end-to-end.

Run either one from inside the project — both identify it the same way (git remote, or a `cortex.json` override), so the same project always lands in the same place regardless of which machine you're on.

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

## cortex sync / pull — sync a project across your own machines

`~/.claude/projects/` uses absolute paths. Switch from your Mac to a Linux server and Claude Code can't find your sessions — the paths don't match. `cortex sync / pull` fixes that, and carries CLAUDE.md, skills, and docs along too — everything encrypted end-to-end.

Run it from inside a project. It's scoped to that project only, the same way `cortex team` is — this is *your* personal version of `cortex team`, without the team: same content (sessions, CLAUDE.md, skills, docs), same per-project scoping, but pushed to your own private storage instead of a shared repo. You can use the same personal backend (one GitHub repo, one Dropbox folder) for every project — each one gets its own namespace inside it, so syncing project B never touches project A's data.

```
Machine A (Mac) — ~/work/myapp          Machine B (Linux) — ~/projects/myapp
────────────────────────────            ──────────────────────────────────
.claude/CLAUDE.md, .claude/skills/  ──┐
~/.claude/projects/-Users-alice-myapp/ ├──▶  cortex          ──▶  same content, paths
    abc123.jsonl                       │      sync → pull          remapped for this
    cwd: /Users/alice/myapp            │                           machine's project dir
                                        │
                    same project (git remote or cortex.json) on both machines
```

### Setup

```bash
# Machine A, from inside the project
cortex init        # pick GitHub repo or local folder (Dropbox / iCloud / Syncthing) — once per machine
cortex sync         # encrypt and upload this project's sessions, CLAUDE.md, skills, docs

# Machine B, from inside the same project (any local path — it's identified by git remote / cortex.json)
cortex init         # same storage, same passphrase
cortex pull         # download, decrypt, remap paths, restore CLAUDE.md/skills/docs
```

Open the project on Machine B — Claude Code shows the session history, CLAUDE.md, and skills you synced from Machine A.

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
| `cortex sync` | Sync this project (sessions, CLAUDE.md, skills, docs) to personal storage |
| `cortex pull` | Download this project's synced context and restore it here, remapped |
| `cortex status` | Show what's out of sync for this project (no download) |
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
| `sync` | Sync the current project (sessions, CLAUDE.md, skills, docs) to personal storage |
| `pull` | Download this project's synced context, decrypt, remap paths |
| `status` | Show what's out of sync for this project |
| `convert` | Convert a skill to Antigravity or Cursor |
| `init` | Configure storage (non-interactive) |

`sync`/`pull`/`status` operate on the directory `cortex mcp` was started in — same scoping as running the CLI commands from a terminal in that project.

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
