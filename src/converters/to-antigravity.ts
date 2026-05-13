import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { callClaude, type SkillMeta } from './shared.js';

const SYSTEM_PROMPT = `You are an expert at converting Claude Code skills to Antigravity format.

Claude Code skills are markdown files with frontmatter and instructions that tell the AI assistant how to behave or execute a specific workflow.

Antigravity uses a similar but distinct format:
- Frontmatter with: name, description, type: skill
- The skill body should be written as clear, direct instructions
- Use <artifact> tags for any templates, code patterns, or structured outputs the skill should produce
- Brain artifacts (content inside <artifact> tags) should have a clear id and optional title
- Preserve the full intent and precision of the original — do NOT simplify or water down the instructions
- If the original skill has step-by-step checklists, keep them
- If the original skill has conditional logic ("if X do Y"), keep it
- Adapt Claude Code specific references (like "TodoWrite", "Edit tool") to Antigravity equivalents where possible, or generalize them

Output ONLY the converted skill file content — no explanations, no markdown code fences.`;

export async function convertToAntigravity(
  skill: SkillMeta,
  apiKey: string,
  outputDir: string,
): Promise<string> {
  const userMessage = `Convert this Claude Code skill to Antigravity format:\n\n${skill.body}`;
  const converted = await callClaude(apiKey, SYSTEM_PROMPT, userMessage);

  const skillDir = join(outputDir, '.agent', 'skills', skill.name);
  const outPath = join(skillDir, 'SKILL.md');

  const alreadyExists = existsSync(outPath);
  if (alreadyExists) {
    const existing = await readFile(outPath, 'utf-8');
    if (existing.trim() === converted.trim()) {
      return outPath; // identical — no write needed
    }
  }

  await mkdir(skillDir, { recursive: true });
  await writeFile(outPath, converted, 'utf-8');
  return outPath;
}
