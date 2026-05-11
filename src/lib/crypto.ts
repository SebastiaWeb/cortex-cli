import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';

const MAGIC = Buffer.from('CTXP', 'utf-8');
const VERSION = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const HEADER_LEN = MAGIC.length + 1 + IV_LEN + TAG_LEN;

const PBKDF2_ITERATIONS = 600_000;

export interface DerivedKey {
  readonly key: Buffer;
}

export function deriveKey(passphrase: string, email: string): DerivedKey {
  if (!passphrase) throw new Error('passphrase is required');
  if (!email) throw new Error('email is required');
  const salt = createHash('sha256').update(email.toLowerCase().trim()).digest();
  const key = pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LEN, 'sha256');
  return { key };
}

export function encrypt(plaintext: Buffer, derived: DerivedKey): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', derived.key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), iv, tag, ciphertext]);
}

export function decrypt(blob: Buffer, derived: DerivedKey): Buffer {
  if (blob.length < HEADER_LEN) throw new Error('cortex blob too short');
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('cortex blob has bad magic bytes');
  }
  const version = blob[MAGIC.length];
  if (version !== VERSION) throw new Error(`cortex blob version ${version} not supported`);
  const ivStart = MAGIC.length + 1;
  const iv = blob.subarray(ivStart, ivStart + IV_LEN);
  const tag = blob.subarray(ivStart + IV_LEN, ivStart + IV_LEN + TAG_LEN);
  const ciphertext = blob.subarray(HEADER_LEN);
  const decipher = createDecipheriv('aes-256-gcm', derived.key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function checksumSha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
