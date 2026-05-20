# cortex team sessions — Design Spec

**Date:** 2026-05-20
**Status:** Approved
**Scope:** Allow team members to optionally share Claude Code chat sessions via the team repo, with one-time consent, configurable encryption, and automatic path remapping on pull.

---

## Problem

`cortex team` shares context (skills, CLAUDE.md, plugins) but not chat sessions. In team or enterprise settings, sessions are monitored and shared by default — every dev's conversations on a project should be visible to the team. There is no mechanism to upload sessions to the team repo or pull teammates' sessions and have Claude Code display them natively.

---

## Goals

1. Let a dev consent once to sharing their sessions during `cortex team init`.
2. Let `cortex team push` automatically upload sessions when consent is given.
3. Let `cortex team pull` download all team members' sessions and install them so Claude Code sees them natively.
4. Support optional encryption with a shared team passphrase.

---

## Architecture

### Consent and config

During `cortex team init`, after the existing setup, a disclaimer prompt is shown:

```
⚠  Compartir sesiones de chat

   Tus sesiones de Claude Code para este proyecto se subirían
   al repo de equipo y serían visibles por todos los miembros.

   Las sesiones pueden contener código privado, keys, o información
   sensible. No se pueden "des-compartir" una vez subidas.

   ¿Compartir sesiones con el equipo? (s/N)
```

If accepted, a second prompt:

```
¿Encriptar las sesiones? (recomendado)
A) Sí — encriptadas con passphrase del equipo
B) No — JSONL plano (legible directo en GitHub)
```

Both answers are stored in `cortex.json` in the project root:

```json
{
  "repo": "https://github.com/user/claude-config",
  "shareSession": true,
  "encryptSessions": true
}
```

If the user declines session sharing, `shareSession: false` and sessions are never touched by team commands.

### Team repo structure

```
team-repo/
├── skills/
├── CLAUDE.md
├── cortex.json          ← plugin manifest (existing)
└── sessions/
    ├── alice@empresa.com/
    │   └── <project-id>/
    │       └── abc123.jsonl        (plain)
    │       └── abc123.jsonl.enc    (encrypted variant)
    └── bob@empresa.com/
        └── <project-id>/
            └── def456.jsonl
```

`<project-id>` is the existing project identifier from `project-identifier.ts` (git remote URL or first commit hash). Each dev has their own subfolder — no filename collisions between devs. Same dev pushing the same session twice overwrites it (git handles deduplication).

### `cortex.json` additions (project-level)

```json
{
  "repo": "https://github.com/user/claude-config",
  "shareSession": true,
  "encryptSessions": true
}
```

---

## Commands

### `cortex team init` (extended)

After existing flow (clone repo, copy skills/CLAUDE.md/plugins, push):

1. Show session disclaimer → wait for `s/N`
2. If accepted: show encryption prompt → wait for `A/B`
3. If `encryptSessions: true`: prompt for `teamPassphrase` (never stored, used only in-session)
4. Write `shareSession` and `encryptSessions` to `cortex.json`

### `cortex team push` (extended)

After existing push logic (skills, CLAUDE.md, cortex.json):

1. Read `shareSession` from `cortex.json` — if false, skip sessions entirely.
2. Identify current project via `project-identifier.ts`.
3. Find sessions in `~/.claude/projects/<path-encode(cwd)>/` — all `.jsonl` files.
4. If `encryptSessions: true`: prompt for `teamPassphrase`, encrypt each file with AES-256-GCM (same crypto as personal sync), write as `<filename>.jsonl.enc`.
5. Copy to `team-repo/sessions/<email>/<project-id>/`.
6. Commit and push alongside skills/CLAUDE.md.

### `cortex team pull` (extended)

After existing pull logic (skills, CLAUDE.md, plugins):

1. Check if `sessions/` directory exists in team repo — if not, skip silently.
2. If any `.jsonl.enc` files exist: prompt for `teamPassphrase` once.
3. For each dev subfolder in `sessions/`:
   - For each `<project-id>/` that matches the current project:
     - Decrypt if `.enc`.
     - Remap paths using existing `jsonl-remapper.ts` logic.
     - Copy to `~/.claude/projects/<local-encoded-path>/`.
4. Claude Code sees all sessions natively on next open.

---

## Encryption

- **Algorithm:** AES-256-GCM (same as personal `cortex sync`)
- **Key derivation:** PBKDF2, 600,000 iterations, SHA-256 — `deriveKey(teamPassphrase, teamEmail)` where `teamEmail` is the Tech Lead's email stored in `~/.cortex/config.json`
- **Passphrase:** Never stored — prompted once per session, held in memory
- **Plain mode:** Files stored as-is; anyone with GitHub access can read them

---

## Conflict handling

- Each dev's sessions live in their own subfolder — no cross-dev collisions.
- Same dev pushing the same session file: overwrites in the team repo (last push wins).
- On pull: sessions from all devs are merged into the local project folder. If a session filename from a teammate collides with a local file (same hash, different dev), the remote is suffixed with the dev's email initials: `abc123.bob.jsonl`.

### Same user, multiple machines

Claude Code generates UUID-based filenames for sessions (`abc123.jsonl`). Two machines belonging to the same dev produce different UUIDs — both push to `sessions/alice@/` without collision. If the same session was previously synced between machines via personal `cortex sync`, both machines have the same UUID and git deduplicates naturally (last push wins, no duplicates in the team repo).

---

## What does NOT change

- `cortex sync` / `cortex pull` — personal session sync is unchanged.
- `cortex install` — first-time install does not pull sessions (only context). Sessions flow via `cortex team pull`.
- Plugin handling — unchanged.
- Existing `shareSession: false` or absent field — commands behave exactly as before.

---

## Out of Scope (MVP)

- Per-session selection UI (choose which sessions to upload) — team scope uploads all automatically.
- Session deletion from team repo.
- Access control per dev (all team members see all sessions).
- `cortex install` pulling sessions on first install.

---

## Success Criteria

1. `cortex team init` shows disclaimer, stores consent in `cortex.json`.
2. `cortex team push` uploads sessions only when `shareSession: true`.
3. `cortex team pull` installs all team sessions; Claude Code shows them on next open.
4. Encrypted and plain modes both work end-to-end.
5. Declining consent leaves existing behavior unchanged.
