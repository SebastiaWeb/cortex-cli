import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CORTEX_DIR } from './config.js';

export const TEAM_DIR = join(CORTEX_DIR, 'team');

export function authUrl(repoUrl: string, token: string): string {
  return repoUrl.replace('https://', `https://${token}@`);
}

export async function hasLocalClone(dir: string = TEAM_DIR): Promise<boolean> {
  try {
    await access(join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

export async function cloneTeamRepo(repoUrl: string, token: string): Promise<void> {
  await rm(TEAM_DIR, { recursive: true, force: true });
  await mkdir(CORTEX_DIR, { recursive: true });
  const result = spawnSync(
    'git',
    ['clone', authUrl(repoUrl, token), TEAM_DIR],
    { stdio: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
  );
  if (result.status !== 0) {
    throw new Error(`git clone failed: ${result.stderr?.toString().trim()}`);
  }
}

export function configureGitUser(dir: string = TEAM_DIR): void {
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'cortex@local'], { stdio: 'pipe' });
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'cortex'], { stdio: 'pipe' });
}

export function pullTeamRepo(dir: string = TEAM_DIR): void {
  const result = spawnSync('git', ['-C', dir, 'pull', '--ff-only'], {
    stdio: 'pipe',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.status !== 0) {
    throw new Error(`git pull failed: ${result.stderr?.toString().trim()}`);
  }
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
  const push = spawnSync('git', ['-C', dir, 'push', authUrl(repoUrl, token)], {
    stdio: 'pipe',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (push.status !== 0) {
    throw new Error(`git push failed: ${push.stderr?.toString().trim()}`);
  }
}
