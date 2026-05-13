import type { CortexConfig } from '../commands/init.js';
import { GitHubBackend } from '../storage/github.js';
import { LocalFilesystemBackend } from '../storage/local.js';
import type { IStorageBackend } from '../storage/types.js';

export function resolveBackend(config: CortexConfig, override?: { target?: string }): IStorageBackend {
  if (override?.target) {
    return new LocalFilesystemBackend(override.target);
  }

  if (config.storage === 'local') {
    if (!config.target) throw new Error('Local storage requires a target path. Run "cortex init" again.');
    return new LocalFilesystemBackend(config.target);
  }

  if (config.storage === 'github') {
    if (!config.githubToken || !config.githubOwner || !config.githubRepo) {
      throw new Error('GitHub storage is not fully configured. Run "cortex init" again.');
    }
    return new GitHubBackend(config.githubToken, config.githubOwner, config.githubRepo);
  }

  throw new Error(
    `Storage backend "${config.storage}" is not yet implemented. Pass --target <path> to use a local folder for now.`,
  );
}
