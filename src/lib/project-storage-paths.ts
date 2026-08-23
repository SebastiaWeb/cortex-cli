import { join } from 'node:path';
import { CORTEX_DIR } from './config.js';

export function remoteManifestPath(projectKey: string): string {
  return `manifest/${projectKey}.json.enc`;
}

export function remoteFilePath(projectKey: string, relPath: string): string {
  return `files/projects/${projectKey}/${relPath}`;
}

export function localManifestPath(projectKey: string): string {
  return join(CORTEX_DIR, 'manifests', `${projectKey}.json`);
}
