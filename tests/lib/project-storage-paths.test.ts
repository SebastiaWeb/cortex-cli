import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  remoteManifestPath,
  remoteFilePath,
  localManifestPath,
} from '../../src/lib/project-storage-paths.js';

describe('remoteManifestPath', () => {
  it('namespaces the manifest under manifest/<projectKey>.json.enc', () => {
    expect(remoteManifestPath('github-com-org-repo')).toBe('manifest/github-com-org-repo.json.enc');
  });
});

describe('remoteFilePath', () => {
  it('namespaces a file under files/projects/<projectKey>/<relPath>', () => {
    expect(remoteFilePath('github-com-org-repo', 'sessions/abc.jsonl')).toBe(
      'files/projects/github-com-org-repo/sessions/abc.jsonl',
    );
  });
});

describe('localManifestPath', () => {
  it('stores the local manifest under ~/.cortex/manifests/<projectKey>.json', () => {
    expect(localManifestPath('github-com-org-repo')).toBe(
      join(homedir(), '.cortex', 'manifests', 'github-com-org-repo.json'),
    );
  });
});
