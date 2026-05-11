import type { CortexConfig } from '../commands/init.js';
import { LocalFilesystemBackend } from '../storage/local.js';
import type { IStorageBackend } from '../storage/types.js';

export function resolveBackend(config: CortexConfig, override?: { target?: string }): IStorageBackend {
  const target = override?.target ?? config.target;
  if (config.storage === 'local' || override?.target) {
    if (!target) throw new Error('Local storage requires a target path (config.target or --target)');
    return new LocalFilesystemBackend(target);
  }
  throw new Error(
    `Storage backend "${config.storage}" is not yet implemented. Pass --target <path> to use a local folder for now.`,
  );
}
