import { gzipSync, gunzipSync } from 'node:zlib';

/**
 * Applied before encrypt() on sync and after decrypt() on pull — JSONL
 * sessions compress ~10:1, which also reduces how often a file trips the
 * backend's per-blob size limits.
 */
export function compress(content: Buffer): Buffer {
  return gzipSync(content);
}

export function decompress(content: Buffer): Buffer {
  return gunzipSync(content);
}
