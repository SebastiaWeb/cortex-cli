import { ClaudeCodeAdapter } from '../adapters/claude-code.js';
import { resolveBackend } from '../lib/backend-resolver.js';
import { loadConfig } from '../lib/config.js';
import { checksumSha256, decrypt, deriveKey } from '../lib/crypto.js';
import { diffManifests, emptyManifest, type Manifest } from '../lib/manifest.js';
import { readPassphrase } from '../lib/passphrase.js';

export interface StatusOptions {
  target?: string;
}

export async function statusCommand(opts: StatusOptions = {}): Promise<void> {
  const config = await loadConfig();
  const passphrase = await readPassphrase();
  const derived = deriveKey(passphrase, config.email);

  const adapter = new ClaudeCodeAdapter();
  const backend = resolveBackend(config, { target: opts.target });

  console.log(`Backend: ${backend.name}\n`);

  const local: Manifest = emptyManifest('claude-code');
  for await (const f of adapter.getFiles()) {
    local.files[f.relativePath] = {
      checksum: checksumSha256(f.content),
      size: f.content.length,
      encryptedSize: 0,
    };
  }

  let remote: Manifest = emptyManifest('claude-code');
  if (await backend.has('manifest.json.enc')) {
    const enc = await backend.read('manifest.json.enc');
    remote = JSON.parse(decrypt(enc, derived).toString('utf-8')) as Manifest;
  } else {
    console.log('(remote has no manifest yet)');
  }

  const diff = diffManifests(local, remote);
  console.log(`  added locally:    ${diff.added.length}`);
  console.log(`  modified locally: ${diff.modified.length}`);
  console.log(`  only on remote:   ${diff.removed.length}`);
  console.log(`  unchanged:        ${diff.unchanged.length}`);
  if (remote.generatedAt) console.log(`\nLast remote sync: ${remote.generatedAt}`);
}
