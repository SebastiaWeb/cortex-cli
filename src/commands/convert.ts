import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { loadApiKey } from '../lib/api-key.js';
import { parseSkillMeta } from '../converters/shared.js';
import { convertToAntigravity } from '../converters/to-antigravity.js';
import { convertToCursor } from '../converters/to-cursor.js';

export type ConvertTarget = 'antigravity' | 'cursor' | 'all';

export interface ConvertOptions {
  to: ConvertTarget;
  outputDir?: string;
}

export async function convertCommand(skillPath: string, opts: ConvertOptions): Promise<void> {
  const absSkillPath = resolve(skillPath);
  const outputDir = resolve(opts.outputDir ?? process.cwd());

  let source: string;
  try {
    source = await readFile(absSkillPath, 'utf-8');
  } catch {
    throw new Error(`Cannot read skill file: ${absSkillPath}`);
  }

  const fallbackName = basename(absSkillPath, extname(absSkillPath)).toLowerCase();
  const skill = parseSkillMeta(source, fallbackName);

  console.log(`Converting "${skill.name}" → ${opts.to}\n`);

  const apiKey = await loadApiKey();

  const targets: Array<'antigravity' | 'cursor'> =
    opts.to === 'all' ? ['antigravity', 'cursor'] : [opts.to];

  for (const target of targets) {
    process.stdout.write(`  ${target}… `);
    let outPath: string;
    if (target === 'antigravity') {
      outPath = await convertToAntigravity(skill, apiKey, outputDir);
    } else {
      outPath = await convertToCursor(skill, apiKey, outputDir);
    }
    console.log(`✓ ${outPath}`);
  }

  console.log('\nDone.');
}
