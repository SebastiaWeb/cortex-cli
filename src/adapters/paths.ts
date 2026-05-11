import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { SupportedTool } from './types.js';

export function resolveToolPath(tool: SupportedTool): string {
  const home = homedir();
  switch (tool) {
    case 'claude-code':
      return join(home, '.claude');
    case 'antigravity':
      return join(home, '.antigravity');
    case 'cursor':
      return join(home, '.cursor');
  }
}

export function isWindows(): boolean {
  return platform() === 'win32';
}
