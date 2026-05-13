import { ClaudeCodeAdapter } from '../adapters/claude-code.js';
import { resolveBackend } from '../lib/backend-resolver.js';
import { MANIFEST_PATH, loadConfig } from '../lib/config.js';
import { checksumSha256, decrypt, deriveKey, encrypt } from '../lib/crypto.js';
import { diffManifests, emptyManifest, type Manifest, saveManifest } from '../lib/manifest.js';
import { readPassphrase } from '../lib/passphrase.js';
import { detectSecrets } from '../lib/secrets-detector.js';
import { extractCwdFromJsonl } from '../lib/jsonl-remapper.js';
import { identifyProject } from '../lib/project-identifier.js';

export interface SyncOptions {
  target?: string;
  skipSecretsCheck?: boolean;
}

export async function syncCommand(opts: SyncOptions = {}): Promise<void> {
  const config = await loadConfig();
  const passphrase = await readPassphrase();
  const derived = deriveKey(passphrase, config.email);

  const adapter = new ClaudeCodeAdapter();
  const backend = resolveBackend(config, { target: opts.target });

  console.log(`Sync target: ${backend.name}${opts.target ? ` (${opts.target})` : ''}\n`);

  console.log('Reading local files…');
  const local: Manifest = emptyManifest('claude-code');
  const contents = new Map<string, Buffer>();
  for await (const f of adapter.getFiles()) {
    contents.set(f.relativePath, f.content);
    local.files[f.relativePath] = {
      checksum: checksumSha256(f.content),
      size: f.content.length,
      encryptedSize: 0,
    };
  }
  console.log(`  ${contents.size} files`);

  // Build project metadata for path remapping on the destination machine.
  local.projects = {};
  const seenDirs = new Set<string>();
  for (const [path, content] of contents) {
    const m = path.match(/^projects\/([^/]+)\/[^/]+\.jsonl$/);
    if (!m || seenDirs.has(m[1])) continue;
    const encodedDir = m[1];
    seenDirs.add(encodedDir);
    const cwd = extractCwdFromJsonl(content);
    if (!cwd) continue;
    const info = identifyProject(cwd);
    local.projects[encodedDir] = { projectId: info?.projectId ?? null, originalPath: cwd };
  }

  if (!opts.skipSecretsCheck) {
    const findings: Array<{ file: string; pattern: string; preview: string }> = [];
    for (const [path, content] of contents) {
      for (const s of detectSecrets(content)) findings.push({ file: path, ...s });
    }
    if (findings.length) {
      console.warn(`\n⚠ Found ${findings.length} potential secrets:`);
      for (const f of findings.slice(0, 10)) {
        console.warn(`  - ${f.file}: ${f.pattern} (${f.preview})`);
      }
      if (findings.length > 10) console.warn(`  …and ${findings.length - 10} more`);
      console.warn('Files are encrypted before upload, but consider removing real secrets.');
      console.warn('Use --skip-secrets-check to bypass.\n');
    }
  }

  console.log('Loading remote manifest…');
  let remote: Manifest = emptyManifest('claude-code');
  if (await backend.has('manifest.json.enc')) {
    const enc = await backend.read('manifest.json.enc');
    remote = JSON.parse(decrypt(enc, derived).toString('utf-8')) as Manifest;
  }

  const diff = diffManifests(local, remote);
  console.log(
    `Diff — added: ${diff.added.length}, modified: ${diff.modified.length}, removed: ${diff.removed.length}, unchanged: ${diff.unchanged.length}`,
  );

  for (const path of [...diff.added, ...diff.modified]) {
    const content = contents.get(path)!;
    const enc = encrypt(content, derived);
    local.files[path].encryptedSize = enc.length;
    await backend.write('files/' + path, enc);
  }
  for (const path of diff.removed) {
    await backend.remove('files/' + path);
  }
  for (const path of diff.unchanged) {
    local.files[path].encryptedSize = remote.files[path].encryptedSize;
  }

  const encryptedManifest = encrypt(Buffer.from(JSON.stringify(local), 'utf-8'), derived);
  await backend.write('manifest.json.enc', encryptedManifest);
  await saveManifest(MANIFEST_PATH, local);

  console.log(
    `\n✓ Sync complete — ${diff.added.length + diff.modified.length} uploaded, ${diff.removed.length} deleted.`,
  );
}
