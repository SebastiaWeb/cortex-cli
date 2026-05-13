import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ProjectInfo {
  projectId: string;
  method: 'git-remote' | 'first-commit' | 'cortex-json';
}

function runGit(cwd: string, args: string): string | null {
  try {
    return execSync(`git ${args}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' })
      .trim();
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
