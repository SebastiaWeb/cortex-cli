import { access, mkdir, rm } from 'node:fs/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { CORTEX_DIR } from './config.js';

export const TEAM_DIR = join(CORTEX_DIR, 'team');

/**
 * repoUrl comes from cortex.json, which is a committed, untrusted file — anyone
 * whose repo you clone controls its content. Without this check, a repoUrl like
 * "--upload-pack=<shell command>" is parsed by git as an OPTION (not a URL),
 * since it's passed to spawnSync as a bare positional argument. git runs the
 * injected command before failing the clone. Verified against the pre-fix code:
 *   git clone "--upload-pack=touch /tmp/pwned;true" file:///tmp/bare /tmp/out
 *   → fatal: could not read from remote repository   (but /tmp/pwned exists)
 * Requiring the https:// scheme up front is sufficient on its own — the string
 * can no longer start with "-" — but every call site below also passes `--`
 * before the URL and disables the ext:: transport, as defense in depth.
 */
export function assertSafeRepoUrl(repoUrl: string): void {
  // file:// is allowed only because this project's own tests clone local bare
  // repos without a network round-trip; production usage (cortex team init's
  // prompt, GitHub-created repos) only ever produces https:// URLs.
  const isHttps = /^https:\/\/[a-zA-Z0-9.-]+(:\d+)?(\/.*)?$/.test(repoUrl);
  const isFile = /^file:\/\//.test(repoUrl);
  if (!isHttps && !isFile) {
    throw new Error(
      `Invalid repo URL: "${repoUrl}". Must start with https:// — refusing to pass this to git.`,
    );
  }
}

function isAuthError(stderr: string): boolean {
  return /authentication failed|could not read (username|password)|403|bad credentials|invalid username/i.test(stderr);
}

function throwGitError(op: string, stderr: string): never {
  if (isAuthError(stderr)) {
    throw new Error(
      `GitHub authentication failed during git ${op}.\n` +
      `Your token may be expired or revoked.\n` +
      `Update it with: cortex set-token <new-token>\n` +
      `(Create a new PAT at: https://github.com/settings/tokens/new?scopes=repo)`,
    );
  }
  throw new Error(`git ${op} failed: ${stderr}`);
}

/**
 * Runs `fn` with a GIT_ASKPASS env that serves `token` as the credential.
 * The token lives only in a temp script file (mode 700, deleted in finally).
 * It never appears in a git URL, so it cannot end up in .git/config or FETCH_HEAD.
 */
function withAskpass(token: string, fn: (env: NodeJS.ProcessEnv) => void): void {
  const tmpDir = mkdtempSync(join(tmpdir(), 'cortex-askpass-'));
  const isWin = process.platform === 'win32';
  const scriptPath = join(tmpDir, isWin ? 'askpass.cmd' : 'askpass.sh');

  if (isWin) {
    writeFileSync(scriptPath, `@echo off\r\necho ${token}\r\n`);
  } else {
    const safe = token.replace(/'/g, "'\\''");
    // Respond to username prompts with a placeholder; serve the PAT for password prompts.
    writeFileSync(
      scriptPath,
      `#!/bin/sh\ncase "$1" in\n  *[Uu]sername*) echo 'x-token-auth' ;;\n  *) printf '%s\\n' '${safe}' ;;\nesac\n`,
      { mode: 0o700 },
    );
  }

  try {
    fn({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: scriptPath });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function hasLocalClone(dir: string = TEAM_DIR): Promise<boolean> {
  try {
    await access(join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

export async function cloneTeamRepo(repoUrl: string, token: string, dir: string = TEAM_DIR): Promise<void> {
  assertSafeRepoUrl(repoUrl);
  await rm(dir, { recursive: true, force: true });
  await mkdir(CORTEX_DIR, { recursive: true });
  withAskpass(token, (env) => {
    const result = spawnSync(
      'git',
      ['-c', 'protocol.ext.allow=never', 'clone', '--', repoUrl, dir],
      { stdio: 'pipe', env },
    );
    if (result.status !== 0) throwGitError('clone', result.stderr?.toString().trim() ?? '');
  });
}

export function configureGitUser(dir: string = TEAM_DIR): void {
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'cortex@local'], { stdio: 'pipe' });
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'cortex'], { stdio: 'pipe' });
}

export function pullTeamRepo(repoUrl: string, token: string, dir: string = TEAM_DIR): void {
  assertSafeRepoUrl(repoUrl);
  withAskpass(token, (env) => {
    const result = spawnSync(
      'git',
      ['-C', dir, '-c', 'protocol.ext.allow=never', 'pull', '--ff-only', '--', repoUrl],
      { stdio: 'pipe', env },
    );
    if (result.status !== 0) throwGitError('pull', result.stderr?.toString().trim() ?? '');
  });
}

export function hasPendingChanges(dir: string = TEAM_DIR): boolean {
  const result = spawnSync('git', ['-C', dir, 'status', '--porcelain'], { stdio: 'pipe' });
  return (result.stdout?.toString().trim() ?? '') !== '';
}

export function commitAndPush(repoUrl: string, token: string, message: string, dir: string = TEAM_DIR): void {
  assertSafeRepoUrl(repoUrl);
  configureGitUser(dir);
  spawnSync('git', ['-C', dir, 'add', '-A'], { stdio: 'pipe' });
  if (!hasPendingChanges(dir)) {
    console.log('Nothing to push — team repo is already up to date.');
    return;
  }
  const commit = spawnSync('git', ['-C', dir, 'commit', '-m', message], { stdio: 'pipe' });
  if (commit.status !== 0) throw new Error('git commit failed');
  withAskpass(token, (env) => {
    const push = spawnSync(
      'git',
      ['-C', dir, '-c', 'protocol.ext.allow=never', 'push', '--', repoUrl],
      { stdio: 'pipe', env },
    );
    if (push.status !== 0) throwGitError('push', push.stderr?.toString().trim() ?? '');
  });
}
