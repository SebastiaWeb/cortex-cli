import { ClaudeCodeAdapter } from '../adapters/claude-code.js';
import { resolveBackend } from '../lib/backend-resolver.js';
import { MANIFEST_PATH, loadConfig } from '../lib/config.js';
import { checksumSha256, decrypt, deriveKey } from '../lib/crypto.js';
import {
  diffManifests,
  emptyManifest,
  loadManifest,
  type Manifest,
  saveManifest,
} from '../lib/manifest.js';
import { readPassphrase } from '../lib/passphrase.js';

export interface PullOptions {
  target?: string;
}

export async function pullCommand(opts: PullOptions = {}): Promise<void> {
  const config = await loadConfig();
  const passphrase = await readPassphrase();
  const derived = deriveKey(passphrase, config.email);

  const adapter = new ClaudeCodeAdapter();
  const backend = resolveBackend(config, { target: opts.target });

  console.log(`Pull source: ${backend.name}${opts.target ? ` (${opts.target})` : ''}\n`);

  if (!(await backend.has('manifest.json.enc'))) {
    throw new Error('Remote has no manifest. Run "cortex sync" on another machine first.');
  }
  const enc = await backend.read('manifest.json.enc');
  const remote = JSON.parse(decrypt(enc, derived).toString('utf-8')) as Manifest;

  const local: Manifest = (await loadManifest(MANIFEST_PATH)) ?? emptyManifest('claude-code');

  // We want files to pull: those present in remote but missing/different locally.
  // Treat from local→remote perspective: "added" = in local but not remote, etc.
  // Here we invert: pull anything where local differs from remote.
  const diff = diffManifests(remote, local);
  const toPull = [...diff.added, ...diff.modified];
  console.log(
    `Diff — to download: ${toPull.length} (new: ${diff.added.length}, changed: ${diff.modified.length}), to remove locally: ${diff.removed.length}`,
  );

  async function* gen() {
    for (const path of toPull) {
      const blob = await backend.read('files/' + path);
      const content = decrypt(blob, derived);
      const expected = remote.files[path].checksum;
      const actual = checksumSha256(content);
      if (expected !== actual) {
        throw new Error(`Checksum mismatch on ${path}: expected ${expected}, got ${actual}`);
      }
      yield { relativePath: path, content };
    }
  }

  await adapter.putFiles(gen());

  await saveManifest(MANIFEST_PATH, remote);
  console.log(`\n✓ Pull complete — ${toPull.length} files restored.`);
}
