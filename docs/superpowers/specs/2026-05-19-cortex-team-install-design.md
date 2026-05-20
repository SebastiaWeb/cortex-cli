# cortex team install — Design Spec

**Date:** 2026-05-19
**Status:** Approved
**Scope:** Add team context sharing to cortex-sync — skills, CLAUDE.md, and plugins distributed via a dedicated GitHub repo, with future VPS support.

---

## Problem

Claude Code context (skills, CLAUDE.md, plugins) lives only on the machine that configured it. When a dev joins the team or switches machines, they start from zero — no shared conventions, no team skills, no configured plugins.

---

## Goals

1. Let a Tech Lead publish their Claude Code setup to a shared GitHub repo.
2. Let any dev install that setup with a single command.
3. Let any dev contribute back (new skills, plugins, updated CLAUDE.md).
4. Prepare the architecture for a future VPS-based distribution layer.

---

## Architecture

### Two roles, one shared repo

```
Tech Lead                         Dev
──────────────────                ──────────────────────────────
cortex team init                  cortex install --repo <url>
cortex team push      ──────▶     cortex team pull
                     claude-config
                        repo
```

### Team config repo structure

```
claude-config/
├── skills/
│   ├── tdd.md
│   └── debugging.md
├── CLAUDE.md
└── cortex.json        ← plugin manifest
```

### `~/.cortex/config.json` additions

```json
{
  "teamRepo": "https://github.com/user/claude-config",
  "githubToken": "ghp_..."
}
```

cortex maintains a local clone of the team repo at `~/.cortex/team/` and uses git internally to detect changes — no custom diffing needed.

### Future VPS

When the VPS is ready, `teamRepo` points to the VPS endpoint instead of GitHub. No command or flow changes.

---

## Commands

| Command | Role | What it does |
|---|---|---|
| `cortex team init --repo <url>` | Tech Lead | One-time setup: connects the repo, pushes initial `~/.claude/` state |
| `cortex team push` | Any dev | Pushes local changes (new skills, plugins, CLAUDE.md) to team repo |
| `cortex team pull` | Any dev | Pulls changes from team repo, installs with conflict resolution |
| `cortex install` | New dev | First-time install: clones team repo and installs everything |

### `cortex install` flag

```bash
cortex install --repo https://github.com/user/claude-config
# On subsequent runs, --repo is optional if already in config.json
```

---

## `cortex.json` (in team repo)

Lists plugins — the only config that can't be represented as a file:

```json
{
  "version": "1",
  "plugins": [
    "superpowers",
    "context7"
  ]
}
```

---

## What gets published / installed

### `cortex team init` / `cortex team push` — reads from local, writes to repo

| What | Source | Destination in repo |
|---|---|---|
| Skills | `~/.claude/skills/*.md` | `skills/` |
| CLAUDE.md | `~/.claude/CLAUDE.md` | `CLAUDE.md` |
| Plugin list | Currently installed plugins | `cortex.json → plugins[]` |

### `cortex install` / `cortex team pull` — reads from repo, writes to local

| What | Source | Destination |
|---|---|---|
| Skills | repo `skills/*.md` | `~/.claude/skills/` |
| CLAUDE.md | repo `CLAUDE.md` | `~/.claude/CLAUDE.md` |
| Plugins | `cortex.json → plugins[]` | `claude plugin install <name>` |

---

## Conflict Resolution

When a local file differs from the repo version:

```
⚠ Conflict: skills/tdd.md

  Local:                          Remote (team):
  ─────────────────────           ────────────────────
  # TDD                           # TDD
  Write tests first.              Write tests first.
  Use describe/it blocks.       + Prefer unit tests over e2e.
                                + Mock external dependencies.

  [M] Merge — keep both versions
  [O] Overwrite — use team version
  [S] Skip — ignore this file for now
```

**Rules:**
- No conflict → installs silently.
- Conflict → shows diff, waits for input per file.
- Plugins → always additive, never uninstalled.

---

## Implementation Notes

- `cortex team` becomes a new subcommand group in `cli.ts`.
- `src/commands/team/` directory with `init.ts`, `push.ts`, `pull.ts`.
- `src/commands/install.ts` for the first-time flow.
- git operations via `child_process` git calls (same pattern as existing commands).
- Conflict diff display via `diff` package or inline line comparison.
- `cortex team push` works like git — detects what changed locally vs. the cached clone and pushes only the delta.

---

## Out of Scope (MVP)

- Per-project CLAUDE.md (team-wide global only for now)
- Private plugin registry (plugins come from Claude Code's public registry)
- Branch-based workflows (one `main` branch in the team repo)
- VPS distribution layer (next phase)

---

## Success Criteria

A new dev can clone the team repo, run `cortex install --repo <url>`, and be fully set up with the same skills, CLAUDE.md, and plugins as the Tech Lead — in under 60 seconds.
