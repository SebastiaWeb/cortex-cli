import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export const LOCAL_SKILLS_DIR = join(process.cwd(), '.claude', 'skills');
export const LOCAL_CLAUDE_MD = join(process.cwd(), '.claude', 'CLAUDE.md');

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
