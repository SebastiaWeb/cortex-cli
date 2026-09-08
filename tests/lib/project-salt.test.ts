import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFilesystemBackend } from '../../src/storage/local.js';
import { getOrCreateSalt } from '../../src/lib/project-salt.js';
import { remoteSaltPath } from '../../src/lib/project-storage-paths.js';

describe('getOrCreateSalt', () => {
  let root: string;
  let backend: LocalFilesystemBackend;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cortex-salt-'));
    backend = new LocalFilesystemBackend(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('generates and stores a new random salt when none exists yet', async () => {
    expect(await backend.has(remoteSaltPath('proj'))).toBe(false);
    const salt = await getOrCreateSalt(backend, 'proj');
    expect(salt.length).toBeGreaterThanOrEqual(16);
    expect(await backend.has(remoteSaltPath('proj'))).toBe(true);
  });

  it('returns the same salt on a second call instead of generating a new one', async () => {
    const first = await getOrCreateSalt(backend, 'proj');
    const second = await getOrCreateSalt(backend, 'proj');
    expect(second.equals(first)).toBe(true);
  });

  it('a second "machine" reading the same backend converges on the salt the first one created', async () => {
    const machineA = await getOrCreateSalt(backend, 'proj');
    // Simulate machine B: fresh call against the same backend, no prior local state.
    const machineB = await getOrCreateSalt(backend, 'proj');
    expect(machineB.equals(machineA)).toBe(true);
  });

  it('different projects on the same backend get different salts', async () => {
    const a = await getOrCreateSalt(backend, 'proj-a');
    const b = await getOrCreateSalt(backend, 'proj-b');
    expect(a.equals(b)).toBe(false);
  });
});
