import { randomBytes } from 'node:crypto';
import type { IStorageBackend } from '../storage/types.js';
import { remoteSaltPath } from './project-storage-paths.js';

const SALT_LEN = 16;

/**
 * Returns this project's random salt, creating and storing one on the backend
 * if it doesn't exist yet. Every machine that syncs this project reads the
 * same stored salt, so the same passphrase always derives the same key —
 * replacing the old salt = SHA256(email), which anyone who knows your email
 * could precompute against.
 */
export async function getOrCreateSalt(backend: IStorageBackend, projectKey: string): Promise<Buffer> {
  const path = remoteSaltPath(projectKey);
  if (await backend.has(path)) {
    return backend.read(path);
  }
  const salt = randomBytes(SALT_LEN);
  await backend.write(path, salt);
  return salt;
}
