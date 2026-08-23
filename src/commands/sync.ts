import { confirm } from '@inquirer/prompts';
import { resolveBackend } from '../lib/backend-resolver.js';
import { loadConfig } from '../lib/config.js';
import { checksumSha256, decrypt, deriveKey, encrypt } from '../lib/crypto.js';
import { diffManifests, emptyManifest, type Manifest, saveManifest } from '../lib/manifest.js';
import { readPassphrase } from '../lib/passphrase.js';
import { detectSecrets, redactSecrets } from '../lib/secrets-detector.js';
import { resolveProjectKey } from '../lib/project-identifier.js';
import { collectProjectFiles } from '../lib/project-content.js';
import { findExtraMdFiles } from '../lib/claude-skills.js';
import { readProjectConfig, writeProjectConfig } from '../lib/project-config.js';
import { remoteManifestPath, remoteFilePath, localManifestPath } from '../lib/project-storage-paths.js';

function isSafeGitHubPath(path: string): boolean {
  return path.split('/').every(
    (c) => c.length > 0 && c !== '.' && c !== '..' && c !== '.git' && !/[\x00-\x1f\x7f]/.test(c),
  );
}

export interface SyncOptions {
  target?: string;
  cwd?: string;
  skipSecretsCheck?: boolean;
  redact?: boolean;
}

export async function syncCommand(opts: SyncOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const config = await loadConfig();
  const passphrase = await readPassphrase();
  const derived = deriveKey(passphrase, config.email);

  const { projectId, projectKey } = resolveProjectKey(cwd);
  const backend = resolveBackend(config, { target: opts.target });

  console.log(`Project: ${projectId}`);
  console.log(`Sync target: ${backend.name}${opts.target ? ` (${opts.target})` : ''}\n`);

  const contents = await collectProjectFiles(cwd);

  // Extra .md docs — ask once per file, remember approval in cortex.json (same UX as `cortex team push`).
  const projectConfig = await readProjectConfig(cwd);
  const approvedDocs = new Set(projectConfig.extraDocs ?? []);
  const extras = await findExtraMdFiles(cwd);
  if (extras.length > 0) {
    const alreadyApproved = extras.filter((f) => approvedDocs.has(f.relPath));
    const newFiles = extras.filter((f) => !approvedDocs.has(f.relPath));
    for (const { relPath, content } of alreadyApproved) {
      contents.set(`docs/${relPath}`, Buffer.from(content, 'utf-8'));
    }
    if (newFiles.length > 0) {
      console.log(`Found ${newFiles.length} new .md file(s):`);
      for (const f of newFiles) console.log(`  ${f.relPath}`);
      const include = await confirm({ message: 'Include these with cortex sync?', default: true });
      if (include) {
        for (const { relPath, content } of newFiles) {
          contents.set(`docs/${relPath}`, Buffer.from(content, 'utf-8'));
        }
        await writeProjectConfig(
          { extraDocs: [...approvedDocs, ...newFiles.map((f) => f.relPath)] },
          cwd,
        );
      }
    }
  }

  console.log(`  ${contents.size} file(s) collected`);

  if (opts.redact) {
    let redactedFiles = 0;
    let redactedTotal = 0;
    for (const [path, content] of contents) {
      const findings = detectSecrets(content);
      if (findings.length === 0) continue;
      contents.set(path, redactSecrets(content));
      redactedFiles++;
      redactedTotal += findings.length;
    }
    if (redactedTotal > 0) {
      console.log(`  Redacted ${redactedTotal} secret(s) in ${redactedFiles} file(s) before encrypting.`);
    }
  }

  const local: Manifest = { ...emptyManifest('claude-code'), originalPath: cwd };
  for (const [path, content] of contents) {
    local.files[path] = { checksum: checksumSha256(content), size: content.length, encryptedSize: 0 };
  }

  if (!opts.skipSecretsCheck) {
    const findings: Array<{ file: string; pattern: string; preview: string }> = [];
    for (const [path, content] of contents) {
      for (const s of detectSecrets(content)) findings.push({ file: path, ...s });
    }
    if (findings.length) {
      console.warn(`\n⚠ Found ${findings.length} potential secrets:`);
      for (const f of findings.slice(0, 10)) console.warn(`  - ${f.file}: ${f.pattern} (${f.preview})`);
      if (findings.length > 10) console.warn(`  …and ${findings.length - 10} more`);
      console.warn('Files are encrypted before upload, but consider removing real secrets.');
      console.warn('Use --skip-secrets-check to bypass.\n');
    }
  }

  const manifestPath = remoteManifestPath(projectKey);
  let remote: Manifest = emptyManifest('claude-code');
  if (await backend.has(manifestPath)) {
    const enc = await backend.read(manifestPath);
    remote = JSON.parse(decrypt(enc, derived).toString('utf-8')) as Manifest;
  }

  const diff = diffManifests(local, remote);
  console.log(
    `Diff — added: ${diff.added.length}, modified: ${diff.modified.length}, removed: ${diff.removed.length}, unchanged: ${diff.unchanged.length}`,
  );

  const toUpload = [...diff.added, ...diff.modified];
  let uploaded = 0;
  let skipped = 0;
  for (const path of toUpload) {
    if (!isSafeGitHubPath(path)) { skipped++; continue; }
    const content = contents.get(path)!;
    const enc = encrypt(content, derived);
    local.files[path].encryptedSize = enc.length;
    try {
      await backend.write(remoteFilePath(projectKey, path), enc);
    } catch (e) {
      process.stdout.write('\n');
      throw new Error(`Upload failed for "${path}": ${(e as Error).message}`);
    }
    uploaded++;
    process.stdout.write(`\r  Uploading… ${uploaded}/${toUpload.length - skipped} files`);
  }
  if (toUpload.length > 0) process.stdout.write('\n');
  if (skipped > 0) {
    console.warn(`  ⚠ Skipped ${skipped} file(s) with paths incompatible with GitHub (control chars, .git, etc.)`);
  }
  for (const path of diff.removed) {
    await backend.remove(remoteFilePath(projectKey, path));
  }
  for (const path of diff.unchanged) {
    local.files[path].encryptedSize = remote.files[path].encryptedSize;
  }

  const encryptedManifest = encrypt(Buffer.from(JSON.stringify(local), 'utf-8'), derived);
  await backend.write(manifestPath, encryptedManifest);
  await saveManifest(localManifestPath(projectKey), local);

  console.log(
    `\n✓ Sync complete — ${diff.added.length + diff.modified.length} uploaded, ${diff.removed.length} deleted.`,
  );
}
