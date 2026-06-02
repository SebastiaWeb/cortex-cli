import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { remapJsonlBuffer, extractCwdFromJsonl } from '../../src/lib/jsonl-remapper.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');

const OLD_PATH = '/home/machineA/projects/myapp';
const NEW_PATH = '/home/machineB/work/myapp';

describe('extractCwdFromJsonl', () => {
  it('returns the cwd from the first line that has one', async () => {
    const buf = await readFile(join(FIXTURES, 'session.jsonl'));
    expect(extractCwdFromJsonl(buf)).toBe(OLD_PATH);
  });

  it('returns null for empty buffer', () => {
    expect(extractCwdFromJsonl(Buffer.alloc(0))).toBeNull();
  });

  it('returns null when no cwd field exists', () => {
    const buf = Buffer.from('{"type":"summary","text":"hello"}\n');
    expect(extractCwdFromJsonl(buf)).toBeNull();
  });
});

describe('remapJsonlBuffer', () => {
  it('returns the same buffer when oldPath === newPath', async () => {
    const buf = await readFile(join(FIXTURES, 'session.jsonl'));
    const out = remapJsonlBuffer(buf, OLD_PATH, OLD_PATH);
    expect(out.equals(buf)).toBe(true);
  });

  it('rewrites cwd fields', async () => {
    const buf = await readFile(join(FIXTURES, 'session.jsonl'));
    const out = remapJsonlBuffer(buf, OLD_PATH, NEW_PATH);
    const lines = out.toString('utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { cwd?: string };
      if ('cwd' in parsed) {
        expect(parsed.cwd).toBe(NEW_PATH);
      }
    }
  });

  it('rewrites message.content[].input.file_path', async () => {
    const buf = await readFile(join(FIXTURES, 'session.jsonl'));
    const out = remapJsonlBuffer(buf, OLD_PATH, NEW_PATH);
    const lines = out.toString('utf-8').split('\n').filter(Boolean);
    const userLine = lines.find((l) => l.includes('"tool_use"'));
    expect(userLine).toBeDefined();
    const parsed = JSON.parse(userLine!) as {
      message: { content: Array<{ input: { file_path: string } }> };
    };
    expect(parsed.message.content[0].input.file_path).toBe(
      NEW_PATH + '/src/index.ts',
    );
  });

  it('rewrites toolUseResult.filePath', async () => {
    const buf = await readFile(join(FIXTURES, 'session.jsonl'));
    const out = remapJsonlBuffer(buf, OLD_PATH, NEW_PATH);
    const lines = out.toString('utf-8').split('\n').filter(Boolean);
    const assistantLine = lines.find((l) => l.includes('"filePath"') && !l.includes('"file":{'));
    expect(assistantLine).toBeDefined();
    const parsed = JSON.parse(assistantLine!) as { toolUseResult: { filePath: string } };
    expect(parsed.toolUseResult.filePath).toBe(NEW_PATH + '/src/index.ts');
  });

  it('rewrites toolUseResult.file.filePath', async () => {
    const buf = await readFile(join(FIXTURES, 'session.jsonl'));
    const out = remapJsonlBuffer(buf, OLD_PATH, NEW_PATH);
    const lines = out.toString('utf-8').split('\n').filter(Boolean);
    const fileLine = lines.find((l) => l.includes('README.md'));
    expect(fileLine).toBeDefined();
    const parsed = JSON.parse(fileLine!) as {
      toolUseResult: { file: { filePath: string } };
    };
    expect(parsed.toolUseResult.file.filePath).toBe(NEW_PATH + '/README.md');
  });

  it('does NOT rewrite historical text content (stdout)', async () => {
    const buf = await readFile(join(FIXTURES, 'session.jsonl'));
    const out = remapJsonlBuffer(buf, OLD_PATH, NEW_PATH);
    const lines = out.toString('utf-8').split('\n').filter(Boolean);
    const stdoutLine = lines.find((l) => l.includes('"stdout"'));
    expect(stdoutLine).toBeDefined();
    const parsed = JSON.parse(stdoutLine!) as { toolUseResult: { stdout: string } };
    // stdout must NOT be remapped — it is historical output
    expect(parsed.toolUseResult.stdout).toBe(OLD_PATH);
  });

  it('does NOT rewrite assistant text content', async () => {
    const buf = await readFile(join(FIXTURES, 'session.jsonl'));
    const out = remapJsonlBuffer(buf, OLD_PATH, NEW_PATH);
    const lines = out.toString('utf-8').split('\n').filter(Boolean);
    const textLine = lines.find(
      (l) => l.includes('"text"') && l.includes('Here is the content'),
    );
    expect(textLine).toBeDefined();
    const parsed = JSON.parse(textLine!) as {
      message: { content: Array<{ text?: string }> };
    };
    const textEntry = parsed.message.content.find((c) => c.text);
    expect(textEntry?.text).toContain(OLD_PATH);
  });

  it('preserves LF line endings', async () => {
    const input = Buffer.from(
      '{"cwd":"/home/machineA/projects/myapp","type":"system"}\n',
      'utf-8',
    );
    const out = remapJsonlBuffer(input, OLD_PATH, NEW_PATH);
    expect(out[out.length - 1]).toBe(0x0a);
  });

  it('preserves CRLF line endings', () => {
    const input = Buffer.from(
      '{"cwd":"/home/machineA/projects/myapp","type":"system"}\r\n',
      'utf-8',
    );
    const out = remapJsonlBuffer(input, OLD_PATH, NEW_PATH);
    expect(out[out.length - 2]).toBe(0x0d);
    expect(out[out.length - 1]).toBe(0x0a);
  });

  it('passes through non-JSON lines unchanged', () => {
    const input = Buffer.from('not json at all\n{"cwd":"/home/machineA/projects/myapp"}\n');
    const out = remapJsonlBuffer(input, OLD_PATH, NEW_PATH);
    const lines = out.toString('utf-8').split('\n').filter(Boolean);
    expect(lines[0]).toBe('not json at all');
    const parsed = JSON.parse(lines[1]) as { cwd: string };
    expect(parsed.cwd).toBe(NEW_PATH);
  });

  it('passes through a JSON string line byte-for-byte', () => {
    // Claude Code control lines can emit non-object JSON; we must not throw or mangle them.
    const input = Buffer.from('"just a control string"\n{"cwd":"/home/machineA/projects/myapp"}\n');
    const out = remapJsonlBuffer(input, OLD_PATH, NEW_PATH);
    const lines = out.toString('utf-8').split('\n').filter(Boolean);
    expect(lines[0]).toBe('"just a control string"');
    expect(JSON.parse(lines[1] as string) as { cwd: string }).toMatchObject({ cwd: NEW_PATH });
  });

  it('passes through a JSON array line byte-for-byte', () => {
    const input = Buffer.from('[1,2,3]\n{"cwd":"/home/machineA/projects/myapp"}\n');
    const out = remapJsonlBuffer(input, OLD_PATH, NEW_PATH);
    const lines = out.toString('utf-8').split('\n').filter(Boolean);
    expect(lines[0]).toBe('[1,2,3]');
  });

  it('passes through a JSON null line byte-for-byte', () => {
    const input = Buffer.from('null\n{"cwd":"/home/machineA/projects/myapp"}\n');
    const out = remapJsonlBuffer(input, OLD_PATH, NEW_PATH);
    const lines = out.toString('utf-8').split('\n').filter(Boolean);
    expect(lines[0]).toBe('null');
  });
});

