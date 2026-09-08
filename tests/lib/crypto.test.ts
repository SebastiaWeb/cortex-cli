import { describe, it, expect } from 'vitest';
import { checksumSha256, decrypt, deriveKey, deriveKeyFromSalt, encrypt } from '../../src/lib/crypto.js';

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

  it('deriveKeyFromSalt produces a 32-byte key, deterministic for the same salt', () => {
    const salt = Buffer.from('0123456789abcdef', 'hex');
    const a = deriveKeyFromSalt(passphrase, salt);
    const b = deriveKeyFromSalt(passphrase, salt);
    expect(a.key.length).toBe(32);
    expect(a.key.equals(b.key)).toBe(true);
  });

  it('deriveKeyFromSalt produces different keys for different salts', () => {
    const a = deriveKeyFromSalt(passphrase, Buffer.from('aaaaaaaaaaaaaaaa', 'hex'));
    const b = deriveKeyFromSalt(passphrase, Buffer.from('bbbbbbbbbbbbbbbb', 'hex'));
    expect(a.key.equals(b.key)).toBe(false);
  });

  describe('AAD (additional authenticated data)', () => {
    it('round-trips when the same AAD is used for encrypt and decrypt', () => {
      const k = deriveKey(passphrase, email);
      const enc = encrypt(Buffer.from('secret content'), k, Buffer.from('files/projects/x/CLAUDE.md'));
      const dec = decrypt(enc, k, Buffer.from('files/projects/x/CLAUDE.md'));
      expect(dec.toString()).toBe('secret content');
    });

    it('decrypt fails when the AAD does not match the path it was encrypted for', () => {
      // This is the attack the fix closes: swap a ciphertext from one storage
      // path to another (e.g. project A's CLAUDE.md renamed to project B's
      // skill file) — decrypt must fail instead of silently returning content
      // that now claims to belong to the wrong path.
      const k = deriveKey(passphrase, email);
      const enc = encrypt(Buffer.from('secret content'), k, Buffer.from('files/projects/a/CLAUDE.md'));
      expect(() => decrypt(enc, k, Buffer.from('files/projects/b/skills/tdd.md'))).toThrow();
    });

    it('decrypt fails when AAD is omitted but the blob was encrypted with one', () => {
      const k = deriveKey(passphrase, email);
      const enc = encrypt(Buffer.from('secret content'), k, Buffer.from('some/path'));
      expect(() => decrypt(enc, k)).toThrow();
    });

    it('encrypt/decrypt without any AAD still round-trips (backward compatible)', () => {
      const k = deriveKey(passphrase, email);
      const enc = encrypt(Buffer.from('no aad here'), k);
      expect(decrypt(enc, k).toString()).toBe('no aad here');
    });
  });

  it('checksumSha256 is stable', () => {
    expect(checksumSha256(Buffer.from('hello'))).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});
