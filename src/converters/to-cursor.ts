import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { callClaude, type SkillMeta } from './shared.js';

const SYSTEM_PROMPT = `You are an expert at converting Claude Code skills to Cursor rules.

Claude Code skills are markdown files that encode workflows and behavioral instructions for the AI.

Cursor rules go in a .cursorrules file and guide the Cursor AI assistant in a project. They are:
- Written as direct instructions ("Always...", "When X, do Y", "Never...")
- Concise but complete — don't omit important constraints
- Project/workflow-focused rather than tool-specific
- Plain text with minimal markdown (headings and bullet lists are fine)

When converting:
- Preserve the core intent and all important constraints from the original
- Replace Claude Code specific tool references with behavior descriptions
  (e.g. "use the Edit tool" → "edit files in place", "use TodoWrite" → "maintain a task list")
- If the skill has a multi-step workflow, convert it to numbered steps
- Do NOT lose conditional logic, edge cases, or guardrails — they are important

Output ONLY the rule content — no section headers, no explanations, no markdown code fences.
The calling code will wrap your output with the appropriate section markers.`;

const SECTION_START = (name: string) => `## ${name}`;
const SECTION_END = (name: string) => `## end ${name}`;

export async function convertToCursor(
  skill: SkillMeta,
  apiKey: string,
  outputDir: string,
): Promise<string> {
  const userMessage = `Convert this Claude Code skill to a Cursor rule block:\n\n${skill.body}`;
  const converted = await callClaude(apiKey, SYSTEM_PROMPT, userMessage);

  const outPath = join(outputDir, '.cursorrules');

  let existing = '';
  if (existsSync(outPath)) {
    existing = await readFile(outPath, 'utf-8');
  }

  // Replace existing section for this skill if present, otherwise append
  const start = SECTION_START(skill.name);
  const end = SECTION_END(skill.name);
  const sectionRegex = new RegExp(
    `${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}\\n?`,
    'g',
  );

  const block = `${start}\n${converted.trim()}\n${end}\n`;

  // Use a non-global regex to test presence (g-flag regex has stateful lastIndex).
  const sectionPresent = new RegExp(
    `${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}`,
  ).test(existing);

  let updated: string;
  if (sectionPresent) {
    updated = existing.replace(sectionRegex, block);
  } else {
    const separator = existing.length > 0 && !existing.endsWith('\n\n') ? '\n\n' : '';
    updated = existing + separator + block;
  }

  await writeFile(outPath, updated, 'utf-8');
  return outPath;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
