import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeProjectPath } from '../../src/lib/path-encoder.js';
import { collectProjectFiles, placeSessionFiles } from '../../src/lib/project-content.js';

describe('collectProjectFiles', () => {
  let claudeHome: string;
  let cwd: string;

  beforeEach(async () => {
    claudeHome = await mkdtemp(join(tmpdir(), 'cortex-home-'));
    cwd = await mkdtemp(join(tmpdir(), 'cortex-cwd-'));
    vi.stubEnv('HOME', claudeHome);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(claudeHome, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it('collects session files under sessions/, CLAUDE.md, and skills/', async () => {
    const encodedCwd = encodeProjectPath(cwd);
    const sessionsDir = join(claudeHome, '.claude', 'projects', encodedCwd);
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, 'abc.jsonl'), `{"cwd":"${cwd}"}\n`);

    await mkdir(join(cwd, '.claude', 'skills'), { recursive: true });
    await writeFile(join(cwd, '.claude', 'CLAUDE.md'), '# Project context');
    await writeFile(join(cwd, '.claude', 'skills', 'tdd.md'), '# TDD skill');

    const files = await collectProjectFiles(cwd);

    expect(files.get('sessions/abc.jsonl')?.toString('utf-8')).toBe(`{"cwd":"${cwd}"}\n`);
    expect(files.get('CLAUDE.md')?.toString('utf-8')).toBe('# Project context');
    expect(files.get('skills/tdd.md')?.toString('utf-8')).toBe('# TDD skill');
  });

  it('strips the cortex-sync path block from CLAUDE.md before collecting', async () => {
    await mkdir(join(cwd, '.claude'), { recursive: true });
    const content = [
      '<!-- cortex-sync:start -->',
      '> **[cortex-sync]** Project root on this machine: `/some/machine/path`',
      '<!-- cortex-sync:end -->',
      '',
      '# Real content',
    ].join('\n');
    await writeFile(join(cwd, '.claude', 'CLAUDE.md'), content);

    const files = await collectProjectFiles(cwd);

    expect(files.get('CLAUDE.md')?.toString('utf-8')).toBe('# Real content');
  });

  it('omits CLAUDE.md and skills when the project has none', async () => {
    const files = await collectProjectFiles(cwd);
    expect(files.has('CLAUDE.md')).toBe(false);
    expect([...files.keys()].some((k) => k.startsWith('skills/'))).toBe(false);
  });
});

describe('placeSessionFiles', () => {
  let claudeHome: string;

  beforeEach(async () => {
    claudeHome = await mkdtemp(join(tmpdir(), 'cortex-home-'));
    vi.stubEnv('HOME', claudeHome);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(claudeHome, { recursive: true, force: true });
  });

  it('writes session files into the local project sessions dir and returns the written content', async () => {
    const cwd = '/home/alice/myapp';
    const sessionFiles = new Map([['abc.jsonl', Buffer.from(`{"cwd":"${cwd}"}\n`)]]);

    const written = await placeSessionFiles(cwd, sessionFiles, cwd);

    expect(written.size).toBe(1);
    expect(written.get('abc.jsonl')?.toString('utf-8')).toBe(`{"cwd":"${cwd}"}\n`);
    const onDisk = await readFile(
      join(claudeHome, '.claude', 'projects', encodeProjectPath(cwd), 'abc.jsonl'),
      'utf-8',
    );
    expect(onDisk).toBe(`{"cwd":"${cwd}"}\n`);
  });

  it('remaps cwd references when the remote originalPath differs from the local cwd', async () => {
    const remotePath = '/Users/alice/work/myapp';
    const localCwd = '/home/alice/myapp';
    const sessionFiles = new Map([['abc.jsonl', Buffer.from(`{"cwd":"${remotePath}"}\n`)]]);

    const written = await placeSessionFiles(localCwd, sessionFiles, remotePath);

    expect(written.get('abc.jsonl')?.toString('utf-8')).toBe(`{"cwd":"${localCwd}"}\n`);
    const onDisk = await readFile(
      join(claudeHome, '.claude', 'projects', encodeProjectPath(localCwd), 'abc.jsonl'),
      'utf-8',
    );
    expect(onDisk).toBe(`{"cwd":"${localCwd}"}\n`);
  });

  it('rejects a session filename crafted for path traversal', async () => {
    // A remote manifest is untrusted input (attacker with backend write access,
    // or the shared team passphrase). A filename like this must never let a
    // write escape the project's session directory.
    const cwd = '/home/alice/myapp';
    const sessionFiles = new Map([['../../../../.bashrc', Buffer.from('pwned')]]);

    await expect(placeSessionFiles(cwd, sessionFiles, cwd)).rejects.toThrow(/traversal/i);
  });
});
