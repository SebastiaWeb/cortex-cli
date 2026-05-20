import { select } from '@inquirer/prompts';

export type DiffLine = { type: 'same' | 'local' | 'remote'; line: string };

export function hasConflict(local: string, remote: string): boolean {
  return local.trim() !== remote.trim();
}

export function buildDiffLines(local: string, remote: string): DiffLine[] {
  const localLines = local.split('\n');
  const remoteLines = remote.split('\n');
  const localSet = new Set(localLines);
  const remoteSet = new Set(remoteLines);
  const all = [...new Set([...localLines, ...remoteLines])];
  return all.map(line => ({
    type: localSet.has(line) && remoteSet.has(line) ? 'same'
        : localSet.has(line) ? 'local'
        : 'remote',
    line,
  }));
}

export function mergeContent(local: string, remote: string): string {
  const localSet = new Set(local.split('\n'));
  const additions = remote.split('\n').filter(l => !localSet.has(l) && l.trim() !== '');
  if (additions.length === 0) return local;
  return local.trimEnd() + '\n\n' + additions.join('\n');
}

export function displayDiff(filename: string, local: string, remote: string): void {
  const diff = buildDiffLines(local, remote);
  console.log(`\n⚠  Conflict: ${filename}`);
  console.log('─'.repeat(50));
  for (const d of diff) {
    if (d.type === 'local') console.log(`  - ${d.line}`);
    else if (d.type === 'remote') console.log(`  + ${d.line}`);
  }
  console.log('─'.repeat(50));
}

export async function promptConflict(
  filename: string,
  local: string,
  remote: string,
): Promise<'merge' | 'overwrite' | 'skip'> {
  displayDiff(filename, local, remote);
  return select({
    message: 'How to resolve?',
    choices: [
      { name: '[M] Merge — keep both versions', value: 'merge' },
      { name: '[O] Overwrite — use team version', value: 'overwrite' },
      { name: '[S] Skip — keep local version', value: 'skip' },
    ],
  });
}
