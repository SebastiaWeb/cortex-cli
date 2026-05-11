interface Pattern {
  name: string;
  regex: RegExp;
}

const PATTERNS: readonly Pattern[] = [
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'GitHub Token', regex: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: 'OpenAI Key', regex: /sk-(proj-)?[A-Za-z0-9_-]{40,}/g },
  { name: 'Anthropic Key', regex: /sk-ant-[A-Za-z0-9_-]{40,}/g },
  { name: 'Stripe Live Key', regex: /sk_live_[A-Za-z0-9]{24,}/g },
  { name: 'Google API Key', regex: /AIza[A-Za-z0-9_-]{35}/g },
  { name: 'Slack Token', regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'Private Key', regex: /-----BEGIN[ A-Z]*PRIVATE KEY-----/g },
];

export interface SecretMatch {
  pattern: string;
  preview: string;
}

export function detectSecrets(content: Buffer | string): SecretMatch[] {
  const text = typeof content === 'string' ? content : content.toString('utf-8');
  const matches: SecretMatch[] = [];
  for (const p of PATTERNS) {
    const regex = new RegExp(p.regex.source, p.regex.flags);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      matches.push({ pattern: p.name, preview: m[0].slice(0, 8) + '…' });
    }
  }
  return matches;
}
