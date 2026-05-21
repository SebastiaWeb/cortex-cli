import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { encodeProjectPath } from '../../src/lib/path-encoder.js';
import { deriveKey } from '../../src/lib/crypto.js';
import {
  localSessionsDir,
  teamSessionsDir,
  readSessionFiles,
  copySessionsToTeamDir,
  copySessionsFromRepo,
} from '../../src/lib/team-sessions.js';

describe('localSessionsDir', () => {
  it('encodes cwd into claude projects path', () => {
    const result = localSessionsDir('/home/alice/myapp');
    expect(result).toBe(join(homedir(), '.claude', 'projects', encodeProjectPath('/home/alice/myapp')));
  });
});

describe('teamSessionsDir', () => {
  it('builds path with email and projectId', () => {
    const result = teamSessionsDir('/some/base', 'alice@co.com', 'my-project-id');
    expect(result).toBe(join('/some/base', 'sessions', 'alice@co.com', 'my-project-id'));
  });
});

describe('readSessionFiles', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'cortex-sess-')); });
  afterEach(async () => { await rm(tmp, { recursive: true }); });

  it('returns empty map for missing directory', async () => {
    const result = await readSessionFiles('/nonexistent/path/xyz');
    expect(result.size).toBe(0);
  });

  it('reads only .jsonl files, ignores others', async () => {
    await writeFile(join(tmp, 'abc.jsonl'), 'session1');
    await writeFile(join(tmp, 'def.jsonl'), 'session2');
    await writeFile(join(tmp, 'readme.txt'), 'skip');
    await writeFile(join(tmp, 'abc.jsonl.enc'), 'skip-enc');
    const result = await readSessionFiles(tmp);
    expect(result.size).toBe(2);
    expect(result.has('abc.jsonl')).toBe(true);
    expect(result.has('def.jsonl')).toBe(true);
  });
});

describe('copySessionsToTeamDir', () => {
  let src: string;
  let dest: string;
  beforeEach(async () => {
    src = await mkdtemp(join(tmpdir(), 'cortex-src-'));
    dest = await mkdtemp(join(tmpdir(), 'cortex-dest-'));
  });
  afterEach(async () => {
    await rm(src, { recursive: true });
    await rm(dest, { recursive: true });
  });

  it('copies plain sessions when no derived key provided', async () => {
    await writeFile(join(src, 'abc.jsonl'), '{"cwd":"/old/path"}');
    const count = await copySessionsToTeamDir(src, dest);
    expect(count).toBe(1);
    const written = await readFile(join(dest, 'abc.jsonl'), 'utf-8');
    expect(written).toBe('{"cwd":"/old/path"}');
  });

  it('returns 0 when source dir is empty', async () => {
    const count = await copySessionsToTeamDir(src, dest);
    expect(count).toBe(0);
  });

  it('encrypts sessions when derived key is provided', async () => {
    await writeFile(join(src, 'abc.jsonl'), '{"cwd":"/old/path"}');
    const derived = deriveKey('passphrase-12chars', 'test@test.com');
    const count = await copySessionsToTeamDir(src, dest, derived);
    expect(count).toBe(1);
    // Written as .enc, not readable as plain text
    const encFile = await readFile(join(dest, 'abc.jsonl.enc'));
    expect(encFile.toString('utf-8')).not.toBe('{"cwd":"/old/path"}');
  });
});

describe('copySessionsFromRepo', () => {
  let sessionsRoot: string;
  let dest: string;
  beforeEach(async () => {
    sessionsRoot = await mkdtemp(join(tmpdir(), 'cortex-repo-'));
    dest = await mkdtemp(join(tmpdir(), 'cortex-local-'));
  });
  afterEach(async () => {
    await rm(sessionsRoot, { recursive: true });
    await rm(dest, { recursive: true });
  });

  it('returns 0 when no sessions dir exists', async () => {
    const count = await copySessionsFromRepo('/nonexistent', 'proj-id', dest, '/local/cwd');
    expect(count).toBe(0);
  });

  it('copies and remaps paths from team repo to local dir', async () => {
    const devDir = join(sessionsRoot, 'alice@co.com', 'proj-id');
    await mkdir(devDir, { recursive: true });
    const session = JSON.stringify({ cwd: '/remote/path', type: 'user' });
    await writeFile(join(devDir, 'abc.jsonl'), session);

    const count = await copySessionsFromRepo(sessionsRoot, 'proj-id', dest, '/local/cwd');
    expect(count).toBe(1);
    const written = JSON.parse(await readFile(join(dest, 'abc.jsonl'), 'utf-8')) as { cwd: string };
    expect(written.cwd).toBe('/local/cwd');
  });

  it('skips encrypted files when no derived key provided', async () => {
    const devDir = join(sessionsRoot, 'alice@co.com', 'proj-id');
    await mkdir(devDir, { recursive: true });
    // Write a fake encrypted file
    await writeFile(join(devDir, 'abc.jsonl.enc'), Buffer.from('fake-cipher-bytes'));

    const count = await copySessionsFromRepo(sessionsRoot, 'proj-id', dest, '/local/cwd');
    expect(count).toBe(0); // skipped, not copied
  });

  it('suffixes filename when collision from second dev', async () => {
    // Alice and Bob both have abc.jsonl for the same project
    for (const dev of ['alice@co.com', 'bob@co.com']) {
      const devDir = join(sessionsRoot, dev, 'proj-id');
      await mkdir(devDir, { recursive: true });
      await writeFile(join(devDir, 'abc.jsonl'), JSON.stringify({ cwd: '/remote', type: 'user' }));
    }

    const count = await copySessionsFromRepo(sessionsRoot, 'proj-id', dest, '/local/cwd');
    expect(count).toBe(2);
    // One goes to abc.jsonl, the other to abc.bob.jsonl (or abc.ali.jsonl)
    const files = await readSessionFiles(dest);
    expect(files.size).toBe(2);
  });
});
