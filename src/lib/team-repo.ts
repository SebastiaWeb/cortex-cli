import { access, mkdir, rm } from 'node:fs/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { CORTEX_DIR } from './config.js';

export const TEAM_DIR = join(CORTEX_DIR, 'team');

export function authUrl(repoUrl: string, token: string): string {
  return repoUrl.replace('https://', `https://${token}@`);
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
  await rm(dir, { recursive: true, force: true });
  await mkdir(CORTEX_DIR, { recursive: true });
  withAskpass(token, (env) => {
    const result = spawnSync('git', ['clone', repoUrl, dir], { stdio: 'pipe', env });
    if (result.status !== 0) {
      throw new Error(`git clone failed: ${result.stderr?.toString().trim()}`);
    }
  });
}

export function configureGitUser(dir: string = TEAM_DIR): void {
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'cortex@local'], { stdio: 'pipe' });
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'cortex'], { stdio: 'pipe' });
}

export function pullTeamRepo(repoUrl: string, token: string, dir: string = TEAM_DIR): void {
  withAskpass(token, (env) => {
    const result = spawnSync('git', ['-C', dir, 'pull', '--ff-only', repoUrl], { stdio: 'pipe', env });
    if (result.status !== 0) {
      throw new Error(`git pull failed: ${result.stderr?.toString().trim()}`);
    }
  });
}

export function hasPendingChanges(dir: string = TEAM_DIR): boolean {
  const result = spawnSync('git', ['-C', dir, 'status', '--porcelain'], { stdio: 'pipe' });
  return (result.stdout?.toString().trim() ?? '') !== '';
}

export function commitAndPush(repoUrl: string, token: string, message: string, dir: string = TEAM_DIR): void {
  configureGitUser(dir);
  spawnSync('git', ['-C', dir, 'add', '-A'], { stdio: 'pipe' });
  if (!hasPendingChanges(dir)) {
    console.log('Nothing to push — team repo is already up to date.');
    return;
  }
  const commit = spawnSync('git', ['-C', dir, 'commit', '-m', message], { stdio: 'pipe' });
  if (commit.status !== 0) throw new Error('git commit failed');
  withAskpass(token, (env) => {
    const push = spawnSync('git', ['-C', dir, 'push', repoUrl], { stdio: 'pipe', env });
    if (push.status !== 0) {
      throw new Error(`git push failed: ${push.stderr?.toString().trim()}`);
    }
  });
}
