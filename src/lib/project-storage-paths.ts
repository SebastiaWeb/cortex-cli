import { join } from 'node:path';
import { CORTEX_DIR } from './config.js';

export function remoteManifestPath(projectKey: string): string {
  return `manifest/${projectKey}.json.enc`;
}

/** Unencrypted by design — a salt isn't secret, it just has to be shared so every
 * machine derives the same key from the same passphrase. See getOrCreateSalt(). */
export function remoteSaltPath(projectKey: string): string {
  return `manifest/${projectKey}.salt`;
}

export function remoteFilePath(projectKey: string, relPath: string): string {
  return `files/projects/${projectKey}/${relPath}`;
}

export function localManifestPath(projectKey: string): string {
  return join(CORTEX_DIR, 'manifests', `${projectKey}.json`);
}
