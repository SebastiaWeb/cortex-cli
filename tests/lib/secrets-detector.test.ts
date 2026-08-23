import { describe, it, expect } from 'vitest';
import { detectSecrets, redactSecrets } from '../../src/lib/secrets-detector.js';

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

describe('redactSecrets', () => {
  it('replaces a matched secret with a labeled placeholder', () => {
    const result = redactSecrets('key=AKIAIOSFODNN7EXAMPLE end');
    expect(result.toString('utf-8')).toBe('key=[REDACTED:AWS Access Key] end');
  });

  it('redacts every match, including multiple different secret types', () => {
    const input = 'aws=AKIAIOSFODNN7EXAMPLE\ngithub=ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD';
    const result = redactSecrets(input).toString('utf-8');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD');
    expect(result).toContain('[REDACTED:AWS Access Key]');
    expect(result).toContain('[REDACTED:GitHub Token]');
  });

  it('leaves clean content byte-for-byte unchanged', () => {
    const clean = Buffer.from('the quick brown fox jumps over the lazy dog');
    expect(redactSecrets(clean).equals(clean)).toBe(true);
  });

  it('accepts a Buffer and returns a Buffer', () => {
    const result = redactSecrets(Buffer.from('AKIAIOSFODNN7EXAMPLE'));
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('after redaction, detectSecrets finds nothing left to warn about', () => {
    const redacted = redactSecrets('AKIAIOSFODNN7EXAMPLE');
    expect(detectSecrets(redacted)).toEqual([]);
  });
});
