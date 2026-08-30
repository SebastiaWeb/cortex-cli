import { join } from 'node:path';
import { resolveBackend } from '../lib/backend-resolver.js';
import { loadConfig } from '../lib/config.js';
import { checksumSha256, decrypt, deriveKey } from '../lib/crypto.js';
import { decompress } from '../lib/compress.js';
import { diffManifests, emptyManifest, loadManifest, type Manifest, saveManifest } from '../lib/manifest.js';
import { readPassphrase } from '../lib/passphrase.js';
import { resolveProjectKey } from '../lib/project-identifier.js';
import { placeSessionFiles } from '../lib/project-content.js';
import { remoteManifestPath, remoteFilePath, localManifestPath } from '../lib/project-storage-paths.js';
import {
  readFileFromPath,
  writeFileToPath,
  injectCortexPathBlock,
} from '../lib/claude-skills.js';
import { hasConflict, promptConflict, mergeContent } from '../lib/conflict.js';
import { safeJoin } from '../lib/safe-path.js';

export interface PullOptions {
  target?: string;
  cwd?: string;
  nonInteractive?: boolean;
}

export interface PullResult {
  filesRestored: number;
}

export async function pullCommand(opts: PullOptions = {}): Promise<PullResult> {
  const cwd = opts.cwd ?? process.cwd();
  const config = await loadConfig();
  const passphrase = await readPassphrase();
  const derived = deriveKey(passphrase, config.email);

  const { projectId, projectKey } = resolveProjectKey(cwd);
  const backend = resolveBackend(config, { target: opts.target });

  console.log(`Project: ${projectId}`);
  console.log(`Pull source: ${backend.name}${opts.target ? ` (${opts.target})` : ''}\n`);

  const manifestPath = remoteManifestPath(projectKey);
  if (!(await backend.has(manifestPath))) {
    throw new Error('No synced data found for this project. Run "cortex sync" first (from any machine).');
  }
  const enc = await backend.read(manifestPath);
  const remote = JSON.parse(decompress(decrypt(enc, derived)).toString('utf-8')) as Manifest;

  const local: Manifest = (await loadManifest(localManifestPath(projectKey))) ?? emptyManifest('claude-code');

  const diff = diffManifests(remote, local);
  const toPull = [...diff.added, ...diff.modified];
  console.log(
    `Diff — to download: ${toPull.length} (new: ${diff.added.length}, changed: ${diff.modified.length})`,
  );

  const downloaded = new Map<string, Buffer>();
  let count = 0;
  for (const path of toPull) {
    const blob = await backend.read(remoteFilePath(projectKey, path));
    const content = decompress(decrypt(blob, derived));
    const expected = remote.files[path].checksum;
    const actual = checksumSha256(content);
    if (expected !== actual) {
      throw new Error(`Checksum mismatch on ${path}: expected ${expected}, got ${actual}`);
    }
    downloaded.set(path, content);
    count++;
    process.stdout.write(`\r  Downloading… ${count}/${toPull.length} files`);
  }
  if (toPull.length > 0) process.stdout.write('\n');

  // Local manifest we're about to save reflects what actually ends up on disk after this
  // pull — remapped session content, merged/overwritten docs — never the remote's raw
  // checksum. Otherwise every subsequent pull would think unchanged files are still stale.
  const localManifest: Manifest = { ...emptyManifest('claude-code'), originalPath: remote.originalPath };
  for (const path of diff.unchanged) {
    localManifest.files[path] = local.files[path];
  }
  const record = (path: string, content: Buffer) => {
    localManifest.files[path] = { checksum: checksumSha256(content), size: content.length, encryptedSize: 0 };
  };

  // Sessions — remapped from the source machine's cwd to this one.
  const sessionFiles = new Map<string, Buffer>();
  for (const [path, content] of downloaded) {
    if (path.startsWith('sessions/')) sessionFiles.set(path.slice('sessions/'.length), content);
  }
  const writtenSessions = await placeSessionFiles(cwd, sessionFiles, remote.originalPath ?? null);
  for (const [filename, content] of writtenSessions) record(`sessions/${filename}`, content);

  // CLAUDE.md — conflict-checked against the local copy, path hint re-injected for this machine.
  let claudeMdWritten = false;
  const remoteClaudeMd = downloaded.get('CLAUDE.md');
  if (remoteClaudeMd) {
    const destPath = join(cwd, '.claude', 'CLAUDE.md');
    const remoteMd = remoteClaudeMd.toString('utf-8');
    const localMd = await readFileFromPath(destPath);
    let finalMd: string | null = null;
    if (!localMd) {
      finalMd = remoteMd;
    } else if (hasConflict(localMd, remoteMd)) {
      if (!opts.nonInteractive) {
        const resolution = await promptConflict('CLAUDE.md', localMd, remoteMd);
        if (resolution === 'overwrite') finalMd = remoteMd;
        else if (resolution === 'merge') finalMd = mergeContent(localMd, remoteMd);
      }
    } else {
      finalMd = remoteMd; // identical content, nothing to resolve
    }
    if (finalMd !== null) {
      await writeFileToPath(destPath, injectCortexPathBlock(finalMd, cwd));
      record('CLAUDE.md', Buffer.from(finalMd, 'utf-8'));
      claudeMdWritten = true;
    }
  }

  // Skills — same conflict flow as `cortex team pull`.
  let skillsWritten = 0;
  const skillsDir = join(cwd, '.claude', 'skills');
  for (const [path, content] of downloaded) {
    if (!path.startsWith('skills/')) continue;
    const filename = path.slice('skills/'.length);
    const remoteContent = content.toString('utf-8');
    const localContent = await readFileFromPath(join(skillsDir, filename));
    let finalContent: string | null = null;
    if (!localContent) {
      finalContent = remoteContent;
    } else if (!hasConflict(localContent, remoteContent)) {
      finalContent = remoteContent;
    } else if (!opts.nonInteractive) {
      const resolution = await promptConflict(filename, localContent, remoteContent);
      if (resolution === 'overwrite') finalContent = remoteContent;
      else if (resolution === 'merge') finalContent = mergeContent(localContent, remoteContent);
    }
    if (finalContent !== null) {
      const destPath = safeJoin(skillsDir, filename); // manifest-controlled filename — reject traversal before writing
      await writeFileToPath(destPath, finalContent);
      record(path, Buffer.from(finalContent, 'utf-8'));
      skillsWritten++;
    }
  }

  // Extra docs — same relative path as the source project, overwritten (no conflict
  // check, matching `cortex team pull`'s behavior for shared docs).
  let docsWritten = 0;
  for (const [path, content] of downloaded) {
    if (!path.startsWith('docs/')) continue;
    const relPath = path.slice('docs/'.length);
    const destPath = safeJoin(cwd, relPath); // manifest-controlled path — reject traversal before writing
    await writeFileToPath(destPath, content.toString('utf-8'));
    record(path, content);
    docsWritten++;
  }

  await saveManifest(localManifestPath(projectKey), localManifest);

  const filesRestored = writtenSessions.size + (claudeMdWritten ? 1 : 0) + skillsWritten + docsWritten;
  console.log(`\n✓ Pull complete — ${filesRestored} file(s) restored.`);
  return { filesRestored };
}
