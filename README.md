# Cortex

Sync your Claude Code context between machines — with intelligent path
remapping that nobody else has solved yet.

> Status: **pre-alpha**. Design docs and roadmap live in
> `../SyncFileMarketPlace/CORTEX_CONTEXT.md` and `CORTEX_ROADMAP.md`.

![demo gif placeholder](docs/demo.gif)

## The problem

Claude Code indexes sessions by absolute path. When you switch machines and the
project lives at a different path (`/Users/sebastian/work/foo` vs
`/home/sebastian/projects/foo`), Claude Code stops recognizing the session —
even if you sync the files manually. Existing sync tools don't fix this.

## Install

```bash
npm install -g cortex-cli
```

## Quickstart

```bash
cortex init      # pick storage (Drive or GitHub), set encryption passphrase
cortex sync      # encrypt and upload ~/.claude/
cortex pull      # restore on another machine — paths get remapped automatically
cortex status    # show what's out of sync
```

## How it works

- **Storage:** your own Google Drive or private GitHub repo. No Cortex server,
  no account, no billing.
- **Encryption:** AES-256-GCM, key derived from your passphrase + email via
  PBKDF2. The passphrase is never written to disk.
- **Path remapping:** detects project identity via git remote URL (primary),
  first commit hash (fallback), or `cortex.json` override, then rewrites the
  structural path fields in each session JSONL.

## License

AGPL-3.0. See `LICENSE`.
