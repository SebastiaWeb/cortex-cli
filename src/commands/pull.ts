import { input } from '@inquirer/prompts';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
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
import { encodeProjectPath } from '../lib/path-encoder.js';
import { loadMappings, saveMappings } from '../lib/path-mappings.js';
import { extractCwdFromJsonl, remapJsonlBuffer } from '../lib/jsonl-remapper.js';

export interface PullOptions {
  target?: string;
}

/**
 * Determine the local path for a project given its remote metadata.
 * Priority:
 *  1. path-mappings.json keyed by projectId (if available)
 *  2. path-mappings.json keyed by originalPath
 *  3. originalPath exists on this machine → same machine / identical layout
 *  4. Prompt user
 */
async function resolveLocalPath(
  projectId: string | null,
  originalPath: string,
  mappings: Record<string, string>,
): Promise<string | null> {
  const key = projectId ?? originalPath;

  if (mappings[key]) return mappings[key];
  if (projectId && mappings[originalPath]) return mappings[originalPath];

  if (existsSync(originalPath)) return originalPath;

  // Interactive prompt
  console.log(`\nProject not found on this machine:`);
  console.log(`  Original path: ${originalPath}`);
  if (projectId) console.log(`  Project ID:    ${projectId}`);
  const answer = await input({
    message: 'Local path (leave empty to skip this project):',
  });
  if (!answer.trim()) return null;
  return answer.trim();
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

  const diff = diffManifests(remote, local);
  const toPull = [...diff.added, ...diff.modified];
  console.log(
    `Diff — to download: ${toPull.length} (new: ${diff.added.length}, changed: ${diff.modified.length}), to remove locally: ${diff.removed.length}`,
  );

  // Build per-encodedDir path remapping table from the remote manifest metadata.
  const mappings = await loadMappings();
  const dirRemap = new Map<string, string | null>(); // oldEncodedDir → newEncodedDir (null = skip)

  if (remote.projects) {
    let mappingsDirty = false;
    for (const [encodedDir, meta] of Object.entries(remote.projects)) {
      // Reject non-absolute originalPath — malformed or tampered manifest entry.
      if (!isAbsolute(meta.originalPath)) {
        console.warn(`Skipping project "${encodedDir}": originalPath is not absolute.`);
        dirRemap.set(encodedDir, null);
        continue;
      }
      const localPath = await resolveLocalPath(meta.projectId, meta.originalPath, mappings);
      if (localPath === null) {
        dirRemap.set(encodedDir, null);
        continue;
      }
      const key = meta.projectId ?? meta.originalPath;
      if (mappings[key] !== localPath) {
        mappings[key] = localPath;
        mappingsDirty = true;
      }
      const newEncoded = encodeProjectPath(localPath);
      dirRemap.set(encodedDir, newEncoded);
    }
    if (mappingsDirty) await saveMappings(mappings);
  }

  async function* gen() {
    for (const path of toPull) {
      const blob = await backend.read('files/' + path);
      const content = decrypt(blob, derived);
      const expected = remote.files[path].checksum;
      const actual = checksumSha256(content);
      if (expected !== actual) {
        throw new Error(`Checksum mismatch on ${path}: expected ${expected}, got ${actual}`);
      }

      // Check if this file belongs to a project directory that needs remapping.
      const m = path.match(/^(projects\/([^/]+))\/(.*\.jsonl)$/);
      if (m && dirRemap.has(m[2])) {
        const oldEncodedDir = m[2];
        const newEncodedDir = dirRemap.get(oldEncodedDir);

        if (newEncodedDir === null) continue; // user skipped this project

        // Determine old path from JSONL content for content remapping.
        const originalPath = remote.projects?.[oldEncodedDir]?.originalPath;
        let remappedContent = content;
        let relativePath = path;

        if (originalPath) {
          // Replace cwd and structural path fields in JSONL.
          const localPath = mappings[remote.projects![oldEncodedDir].projectId ?? originalPath]
            ?? originalPath;
          remappedContent = remapJsonlBuffer(content, originalPath, localPath);
        }

        // Rename the directory portion of the path.
        if (newEncodedDir !== oldEncodedDir) {
          relativePath = `projects/${newEncodedDir}/${m[3]}`;
        }

        yield { relativePath, content: remappedContent };
      } else {
        yield { relativePath: path, content };
      }
    }
  }

  await adapter.putFiles(gen());

  await saveManifest(MANIFEST_PATH, remote);
  console.log(`\n✓ Pull complete — ${toPull.length} files restored.`);
}
