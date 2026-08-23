import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeProjectPath } from './path-encoder.js';

export interface ProjectInfo {
  projectId: string;
  method: 'git-remote' | 'first-commit' | 'cortex-json';
}

function runGit(cwd: string, args: string): string | null {
  try {
    return execSync(`git ${args}`, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 5000, // 5 s max — avoids hanging on unreachable remotes
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Returns a stable projectId for a directory on disk.
 *
 * Priority:
 *  1. cortex.json override ({"projectId": "..."})
 *  2. git remote.origin.url  — stable across machines
 *  3. hash of first commit   — stable across forks/clones
 *
 * Returns null when none of the methods yield a result.
 */
export function identifyProject(dir: string): ProjectInfo | null {
  // 1. Manual override
  const override = join(dir, 'cortex.json');
  if (existsSync(override)) {
    try {
      const data = JSON.parse(readFileSync(override, 'utf-8')) as { projectId?: string };
      if (typeof data.projectId === 'string' && data.projectId.length > 0) {
        return { projectId: data.projectId.trim(), method: 'cortex-json' };
      }
    } catch {
      // malformed cortex.json — fall through
    }
  }

  // 2. Git remote URL
  const remoteUrl = runGit(dir, 'config --get remote.origin.url');
  if (remoteUrl) {
    // Normalize: strip trailing .git, lowercase
    const normalized = remoteUrl.replace(/\.git$/i, '').toLowerCase().trim();
    return { projectId: normalized, method: 'git-remote' };
  }

  // 3. First commit hash (invariant across forks/clones)
  const firstCommit = runGit(dir, 'rev-list --max-parents=0 HEAD');
  if (firstCommit) {
    return { projectId: `git:${firstCommit}`, method: 'first-commit' };
  }

  return null;
}

export interface ProjectKey {
  projectId: string;
  projectKey: string; // filesystem/GitHub-safe storage namespace derived from projectId
}

/**
 * Resolves the stable storage namespace for personal `cortex sync`/`pull`/`status`,
 * scoped to `dir` — the same identification cortex team already uses.
 */
export function resolveProjectKey(dir: string): ProjectKey {
  const info = identifyProject(dir);
  if (!info) {
    throw new Error(
      'Could not identify this project (no git remote, no first commit, and no cortex.json).\n' +
        'Run this inside a git repository, or add a "projectId" field to cortex.json in the project root.',
    );
  }
  return { projectId: info.projectId, projectKey: encodeProjectPath(info.projectId) };
}
