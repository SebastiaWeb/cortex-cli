/**
 * End-to-end: Machine A syncs a project at /old/path, Machine B pulls it
 * and the JSONL lands at /new/path with all structural fields remapped.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { placeSessionFiles } from '../../src/lib/project-content.js';
import { encodeProjectPath } from '../../src/lib/path-encoder.js';
import { extractCwdFromJsonl } from '../../src/lib/jsonl-remapper.js';

describe('path-remap round-trip', () => {
  let claudeHome: string;

  const OLD_PROJECT = '/home/machineA/work/myapp';
  const NEW_PROJECT = '/home/machineB/projects/myapp';

  const SESSION_JSONL = [
    JSON.stringify({ type: 'system', cwd: OLD_PROJECT, uuid: 'u1' }),
    JSON.stringify({
      type: 'user',
      cwd: OLD_PROJECT,
      uuid: 'u2',
      message: {
        role: 'user',
        content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: OLD_PROJECT + '/index.ts' } }],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      cwd: OLD_PROJECT,
      uuid: 'u3',
      toolUseResult: { filePath: OLD_PROJECT + '/index.ts', content: 'export {}' },
    }),
    JSON.stringify({
      type: 'assistant',
      cwd: OLD_PROJECT,
      uuid: 'u4',
      toolUseResult: { stdout: OLD_PROJECT, stderr: '' },
    }),
  ].join('\n') + '\n';

  beforeEach(async () => {
    claudeHome = await mkdtemp(join(tmpdir(), 'cortex-remap-home-'));
    vi.stubEnv('HOME', claudeHome);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(claudeHome, { recursive: true, force: true });
  });

  it('structural fields are remapped; historical fields are preserved', async () => {
    // Simulates pull.ts: a session synced from OLD_PROJECT lands on this
    // machine at NEW_PROJECT, via placeSessionFiles (same call pull.ts makes).
    const sessionFiles = new Map([['session.jsonl', Buffer.from(SESSION_JSONL)]]);
    await placeSessionFiles(NEW_PROJECT, sessionFiles, OLD_PROJECT);

    const newEncoded = encodeProjectPath(NEW_PROJECT);
    const sessionOnB = await readFile(
      join(homedir(), '.claude', 'projects', newEncoded, 'session.jsonl'),
    );
    const lines = sessionOnB
      .toString('utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    // cwd fields remapped
    for (const line of lines) {
      if ('cwd' in line) expect(line['cwd']).toBe(NEW_PROJECT);
    }

    // structural file_path remapped
    const userLine = lines.find((l) => {
      const msg = l['message'] as { content: Array<{ input?: { file_path?: string } }> } | undefined;
      return msg?.content?.[0]?.input?.file_path !== undefined;
    });
    expect(userLine).toBeDefined();
    const filePath = (
      (userLine!['message'] as { content: Array<{ input: { file_path: string } }> }).content[0]
        .input.file_path
    );
    expect(filePath).toBe(NEW_PROJECT + '/index.ts');

    // structural toolUseResult.filePath remapped
    const toolLine = lines.find(
      (l) => (l['toolUseResult'] as { filePath?: string } | undefined)?.filePath !== undefined,
    );
    expect(toolLine).toBeDefined();
    expect((toolLine!['toolUseResult'] as { filePath: string }).filePath).toBe(
      NEW_PROJECT + '/index.ts',
    );

    // historical stdout NOT remapped
    const stdoutLine = lines.find(
      (l) => (l['toolUseResult'] as { stdout?: string } | undefined)?.stdout !== undefined,
    );
    expect(stdoutLine).toBeDefined();
    expect((stdoutLine!['toolUseResult'] as { stdout: string }).stdout).toBe(OLD_PROJECT);

    // extractCwdFromJsonl reads new path from remapped content
    expect(extractCwdFromJsonl(sessionOnB)).toBe(NEW_PROJECT);
  });
});
