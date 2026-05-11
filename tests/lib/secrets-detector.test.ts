import { describe, it, expect } from 'vitest';
import { detectSecrets } from '../../src/lib/secrets-detector.js';

describe('secrets-detector', () => {
  it('finds AWS access key', () => {
    const hits = detectSecrets('AKIAIOSFODNN7EXAMPLE');
    expect(hits.some((h) => h.pattern === 'AWS Access Key')).toBe(true);
  });

  it('finds GitHub token', () => {
    const hits = detectSecrets('token=ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD');
    expect(hits.some((h) => h.pattern === 'GitHub Token')).toBe(true);
  });

  it('finds Anthropic key', () => {
    const hits = detectSecrets('sk-ant-' + 'a'.repeat(50));
    expect(hits.some((h) => h.pattern === 'Anthropic Key')).toBe(true);
  });

  it('finds PEM private key header', () => {
    const hits = detectSecrets('-----BEGIN RSA PRIVATE KEY-----\nbase64data');
    expect(hits.some((h) => h.pattern === 'Private Key')).toBe(true);
  });

  it('returns empty for clean text', () => {
    expect(detectSecrets('the quick brown fox jumps over the lazy dog')).toEqual([]);
  });

  it('preview is truncated to 8 chars + ellipsis', () => {
    const hits = detectSecrets('AKIAIOSFODNN7EXAMPLE');
    expect(hits[0].preview).toBe('AKIAIOSF…');
  });
});
