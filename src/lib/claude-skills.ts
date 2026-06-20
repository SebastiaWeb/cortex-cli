import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export const LOCAL_SKILLS_DIR = join(process.cwd(), '.claude', 'skills');
export const LOCAL_CLAUDE_MD = join(process.cwd(), '.claude', 'CLAUDE.md');

/**
 * Finds CLAUDE.md in the standard locations, in priority order:
 *  1. .claude/CLAUDE.md  (canonical Claude Code location)
 *  2. CLAUDE.md          (project root fallback)
 */
export async function findClaudeMd(cwd: string = process.cwd()): Promise<{ content: string; foundAt: string } | null> {
  const candidates = [
    { path: join(cwd, '.claude', 'CLAUDE.md'), foundAt: '.claude/CLAUDE.md' },
    { path: join(cwd, 'CLAUDE.md'),            foundAt: 'CLAUDE.md' },
  ];
  for (const { path, foundAt } of candidates) {
    const content = await readFileFromPath(path);
    if (content !== null) return { content, foundAt };
  }
  return null;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.cache', 'vendor', 'tmp', 'out', '.turbo',
]);

/**
 * Finds extra .md files the user may want to share with the team.
 * Scope:
 *  - Root level:        <cwd>/*.md          (excluding CLAUDE.md)
 *  - Second level:      <cwd>/<dir>/*.md    (non-hidden, non-blacklisted dirs)
 *  - Inside .claude/:  <cwd>/.claude/**     (excluding CLAUDE.md and skills/)
 */
export async function findExtraMdFiles(cwd: string = process.cwd()): Promise<Array<{ relPath: string; content: string }>> {
  const results: Array<{ relPath: string; content: string }> = [];
  const seen = new Set<string>();

  const add = async (relPath: string) => {
    if (seen.has(relPath)) return;
    seen.add(relPath);
    const content = await readFileFromPath(join(cwd, relPath));
    if (content !== null) results.push({ relPath, content });
  };

  const rootEntries = await readdir(cwd, { withFileTypes: true }).catch(() => []);

  // Level 1: root *.md (excluding CLAUDE.md — handled by findClaudeMd)
  for (const e of rootEntries) {
    if (e.isFile() && e.name.endsWith('.md') && e.name !== 'CLAUDE.md') {
      await add(e.name);
    }
  }

  // Level 2: <dir>/*.md (non-hidden, non-blacklisted, skip .claude which is handled below)
  for (const e of rootEntries) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const subEntries = await readdir(join(cwd, e.name), { withFileTypes: true }).catch(() => []);
    for (const se of subEntries) {
      if (se.isFile() && se.name.endsWith('.md')) {
        await add(join(e.name, se.name));
      }
    }
  }

  // Everything inside .claude/ that isn't CLAUDE.md or under skills/
  const dotClaude = join(cwd, '.claude');
  const dotClaudeEntries = await readdir(dotClaude, { withFileTypes: true }).catch(() => []);
  for (const e of dotClaudeEntries) {
    if (e.isFile() && e.name.endsWith('.md') && e.name !== 'CLAUDE.md') {
      await add(join('.claude', e.name));
    }
    if (e.isDirectory() && e.name !== 'skills') {
      const subEntries = await readdir(join(dotClaude, e.name), { withFileTypes: true }).catch(() => []);
      for (const se of subEntries) {
        if (se.isFile() && se.name.endsWith('.md')) {
          await add(join('.claude', e.name, se.name));
        }
      }
    }
  }

  return results;
}

/**
 * Reads all .md files from a team repo docs/ directory, returning
 * a map of relPath → content (paths relative to the docs/ root).
 */
export async function readExtraDocsFromDir(docsDir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const walk = async (dir: string, prefix: string) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.md')) {
        const relPath = prefix ? join(prefix, e.name) : e.name;
        const content = await readFileFromPath(join(dir, e.name));
        if (content !== null) map.set(relPath, content);
      } else if (e.isDirectory()) {
        await walk(join(dir, e.name), prefix ? join(prefix, e.name) : e.name);
      }
    }
  };

  await walk(docsDir, '');
  return map;
}

export async function readSkillsFromDir(dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return map;
  }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.md')) {
      const content = await readFile(join(dir, e.name), 'utf-8');
      map.set(e.name, content);
    }
  }
  return map;
}

export async function writeSkillToDir(dir: string, filename: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), content, 'utf-8');
}

export async function readFileFromPath(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function writeFileToPath(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

const CORTEX_BLOCK_START = '<!-- cortex-sync:start -->';
const CORTEX_BLOCK_END = '<!-- cortex-sync:end -->';

export function injectCortexPathBlock(content: string, cwd: string): string {
  const block = [
    CORTEX_BLOCK_START,
    `> **[cortex-sync]** Project root on this machine: \`${cwd}\``,
    `> Sessions shared via cortex-sync may reference paths from other machines. Always resolve file operations against the project root above.`,
    CORTEX_BLOCK_END,
  ].join('\n');

  const startIdx = content.indexOf(CORTEX_BLOCK_START);
  const endIdx = content.indexOf(CORTEX_BLOCK_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + CORTEX_BLOCK_END.length);
    return before + block + after;
  }

  const separator = content.length > 0 ? '\n\n' : '';
  return block + separator + content;
}
