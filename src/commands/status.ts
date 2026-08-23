import { resolveBackend } from '../lib/backend-resolver.js';
import { loadConfig } from '../lib/config.js';
import { checksumSha256, decrypt, deriveKey } from '../lib/crypto.js';
import { diffManifests, emptyManifest, type Manifest } from '../lib/manifest.js';
import { readPassphrase } from '../lib/passphrase.js';
import { resolveProjectKey } from '../lib/project-identifier.js';
import { collectProjectFiles } from '../lib/project-content.js';
import { remoteManifestPath } from '../lib/project-storage-paths.js';

export interface StatusOptions {
  target?: string;
  cwd?: string;
}

export async function statusCommand(opts: StatusOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const config = await loadConfig();
  const passphrase = await readPassphrase();
  const derived = deriveKey(passphrase, config.email);

  const { projectId, projectKey } = resolveProjectKey(cwd);
  const backend = resolveBackend(config, { target: opts.target });

  console.log(`Project: ${projectId}`);
  console.log(`Backend: ${backend.name}\n`);

  const contents = await collectProjectFiles(cwd);
  const local: Manifest = emptyManifest('claude-code');
  for (const [path, content] of contents) {
    local.files[path] = { checksum: checksumSha256(content), size: content.length, encryptedSize: 0 };
  }

  const manifestPath = remoteManifestPath(projectKey);
  let remote: Manifest = emptyManifest('claude-code');
  if (await backend.has(manifestPath)) {
    const enc = await backend.read(manifestPath);
    remote = JSON.parse(decrypt(enc, derived).toString('utf-8')) as Manifest;
  } else {
    console.log('(no synced data for this project yet)');
  }

  const diff = diffManifests(local, remote);
  console.log(`  added locally:    ${diff.added.length}`);
  console.log(`  modified locally: ${diff.modified.length}`);
  console.log(`  only on remote:   ${diff.removed.length}`);
  console.log(`  unchanged:        ${diff.unchanged.length}`);
  if (remote.generatedAt) console.log(`\nLast remote sync: ${remote.generatedAt}`);
}
