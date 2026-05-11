import { describe, it, expect } from 'vitest';
import { checksumSha256, decrypt, deriveKey, encrypt } from '../../src/lib/crypto.js';

describe('crypto', () => {
  const email = 'user@example.com';
  const passphrase = 'correct-horse-battery-staple';

  it('deriveKey produces a 32-byte key', () => {
    const k = deriveKey(passphrase, email);
    expect(k.key.length).toBe(32);
  });

  it('deriveKey is deterministic for same passphrase+email', () => {
    const a = deriveKey(passphrase, email);
    const b = deriveKey(passphrase, email);
    expect(a.key.equals(b.key)).toBe(true);
  });

  it('deriveKey is case-insensitive on email', () => {
    const a = deriveKey(passphrase, 'User@Example.com');
    const b = deriveKey(passphrase, 'user@example.com');
    expect(a.key.equals(b.key)).toBe(true);
  });

  it('encrypt/decrypt round-trip preserves bytes', () => {
    const k = deriveKey(passphrase, email);
    const plaintext = Buffer.from('hello cortex 🦊');
    const enc = encrypt(plaintext, k);
    const dec = decrypt(enc, k);
    expect(dec.equals(plaintext)).toBe(true);
  });

  it('encrypt produces different ciphertexts for same plaintext (random IV)', () => {
    const k = deriveKey(passphrase, email);
    const a = encrypt(Buffer.from('foo'), k);
    const b = encrypt(Buffer.from('foo'), k);
    expect(a.equals(b)).toBe(false);
  });

  it('decrypt with wrong key fails', () => {
    const right = deriveKey(passphrase, email);
    const wrong = deriveKey('different-passphrase-here', email);
    const enc = encrypt(Buffer.from('secret'), right);
    expect(() => decrypt(enc, wrong)).toThrow();
  });

  it('decrypt rejects blob with bad magic', () => {
    const k = deriveKey(passphrase, email);
    const bad = Buffer.concat([Buffer.from('XXXX'), Buffer.alloc(50)]);
    expect(() => decrypt(bad, k)).toThrow(/magic/);
  });

  it('checksumSha256 is stable', () => {
    expect(checksumSha256(Buffer.from('hello'))).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});
