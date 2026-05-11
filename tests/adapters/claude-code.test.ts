import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';

describe('ClaudeCodeAdapter', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'cortex-test-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('reads files recursively with forward-slash relative paths', async () => {
    await mkdir(join(tempRoot, 'projects', 'foo'), { recursive: true });
    await writeFile(join(tempRoot, 'settings.json'), '{}');
    await writeFile(join(tempRoot, 'projects', 'foo', 'a.jsonl'), 'line\n');

    const adapter = new ClaudeCodeAdapter(tempRoot);
    const files = [];
    for await (const f of adapter.getFiles()) files.push(f);

    const paths = files.map((f) => f.relativePath).sort();
    expect(paths).toEqual(['projects/foo/a.jsonl', 'settings.json']);
  });

  it('writes files preserving relative path structure', async () => {
    const adapter = new ClaudeCodeAdapter(tempRoot);
    async function* gen() {
      yield { relativePath: 'projects/bar/x.jsonl', content: Buffer.from('hello') };
    }
    await adapter.putFiles(gen());
    const written = await readFile(join(tempRoot, 'projects', 'bar', 'x.jsonl'), 'utf8');
    expect(written).toBe('hello');
  });

  it('getProjectPath joins the encoded name under projects/', () => {
    const adapter = new ClaudeCodeAdapter(tempRoot);
    const p = adapter.getProjectPath('-tmp-foo-bar');
    expect(p).toBe(join(tempRoot, 'projects', '-tmp-foo-bar'));
  });
});
