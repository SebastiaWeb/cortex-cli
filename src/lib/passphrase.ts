import { password } from '@inquirer/prompts';

export async function readPassphrase(): Promise<string> {
  if (process.env.CORTEX_PASSPHRASE) return process.env.CORTEX_PASSPHRASE;
  return password({
    message: 'Encryption passphrase:',
    mask: '*',
    validate: (v) => v.length >= 12 || 'Minimum 12 characters',
  });
}
