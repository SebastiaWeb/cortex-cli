import Anthropic from '@anthropic-ai/sdk';

export interface SkillMeta {
  name: string;
  description?: string;
  body: string; // full file content
}

/** Parse frontmatter name/description from a skill file. Falls back to filename. */
export function parseSkillMeta(content: string, fallbackName: string): SkillMeta {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  let name = fallbackName;
  let description: string | undefined;

  if (fm) {
    const nameMatch = fm[1].match(/^name:\s*(.+)$/m);
    const descMatch = fm[1].match(/^description:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim();
    if (descMatch) description = descMatch[1].trim();
  }

  return { name, description, body: content };
}

export async function callClaude(apiKey: string, systemPrompt: string, userMessage: string): Promise<string> {
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });
  const block = msg.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude API');
  return block.text;
}
