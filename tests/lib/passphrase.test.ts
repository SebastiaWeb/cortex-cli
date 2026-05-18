import { afterEach, describe, expect, it } from 'vitest';
import { readPassphrase } from '../../src/lib/passphrase.js';

describe('readPassphrase', () => {
  afterEach(() => {
    delete process.env.CORTEX_PASSPHRASE;
  });

  it('returns CORTEX_PASSPHRASE env var without prompting', async () => {
    process.env.CORTEX_PASSPHRASE = 'env-passphrase-12chars';
    const result = await readPassphrase();
    expect(result).toBe('env-passphrase-12chars');
  });
});
