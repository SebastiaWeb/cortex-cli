import { afterEach, describe, expect, it } from 'vitest';
import { loadApiKey } from '../../src/lib/api-key.js';

describe('loadApiKey nonInteractive', () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns ANTHROPIC_API_KEY env var', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    const key = await loadApiKey({ nonInteractive: true });
    expect(key).toBe('sk-ant-test-key');
  });

  it('throws in nonInteractive mode when no key available', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(loadApiKey({ nonInteractive: true })).rejects.toThrow('ANTHROPIC_API_KEY');
  });
});
