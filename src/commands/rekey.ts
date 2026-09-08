import { randomBytes } from 'node:crypto';
import { resolveBackend } from '../lib/backend-resolver.js';
import { loadConfig } from '../lib/config.js';
import { decrypt, deriveKeyFromSalt, encrypt } from '../lib/crypto.js';
import { compress, decompress } from '../lib/compress.js';
import type { Manifest } from '../lib/manifest.js';
import { readPassphrase } from '../lib/passphrase.js';
import { resolveProjectKey } from '../lib/project-identifier.js';
import { remoteFilePath, remoteManifestPath, remoteSaltPath } from '../lib/project-storage-paths.js';
import { getOrCreateSalt } from '../lib/project-salt.js';

const SALT_LEN = 16;

export interface RekeyOptions {
  target?: string;
  cwd?: string;
}

/**
 * Rotates the project's salt and re-encrypts everything under the new
 * derived key, in one atomic batch write. Content is decrypted and
 * re-encrypted at the compressed-ciphertext layer (no need to touch
 * plaintext) — only the encryption key changes, not the data.
 */
export async function rekeyCommand(opts: RekeyOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const config = await loadConfig();
  const passphrase = await readPassphrase();

  const { projectId, projectKey } = resolveProjectKey(cwd);
  const backend = resolveBackend(config, { target: opts.target });

  console.log(`Project: ${projectId}`);
  console.log(`Rekey target: ${backend.name}${opts.target ? ` (${opts.target})` : ''}\n`);

  const manifestPath = remoteManifestPath(projectKey);
  if (!(await backend.has(manifestPath))) {
    throw new Error('Nothing to rekey — no synced data found for this project. Run "cortex sync" first.');
  }

  const oldSalt = await getOrCreateSalt(backend, projectKey);
  const oldDerived = deriveKeyFromSalt(passphrase, oldSalt);

  const encManifest = await backend.read(manifestPath);
  const manifest = JSON.parse(
    decompress(decrypt(encManifest, oldDerived, Buffer.from(manifestPath))).toString('utf-8'),
  ) as Manifest;

  const newSalt = randomBytes(SALT_LEN);
  const newDerived = deriveKeyFromSalt(passphrase, newSalt);

  const paths = Object.keys(manifest.files);
  const uploads: Array<{ path: string; content: Buffer }> = [];
  let count = 0;
  for (const relPath of paths) {
    const destPath = remoteFilePath(projectKey, relPath);
    const encBlob = await backend.read(destPath);
    const compressed = decrypt(encBlob, oldDerived, Buffer.from(destPath));
    uploads.push({ path: destPath, content: encrypt(compressed, newDerived, Buffer.from(destPath)) });
    count++;
    process.stdout.write(`\r  Re-encrypting… ${count}/${paths.length} file(s)`);
  }
  if (paths.length > 0) process.stdout.write('\n');

  uploads.push({
    path: manifestPath,
    content: encrypt(compress(Buffer.from(JSON.stringify(manifest), 'utf-8')), newDerived, Buffer.from(manifestPath)),
  });
  uploads.push({ path: remoteSaltPath(projectKey), content: newSalt });

  await backend.writeMany(uploads);

  console.log(`\n✓ Rekey complete — ${paths.length} file(s) re-encrypted under a new key.`);
}
