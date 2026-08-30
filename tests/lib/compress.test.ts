import { describe, it, expect } from 'vitest';
import { compress, decompress } from '../../src/lib/compress.js';

describe('compress/decompress', () => {
  it('round-trips content exactly', () => {
    const original = Buffer.from(JSON.stringify({ cwd: '/home/alice/app', type: 'user' }).repeat(50));
    const compressed = compress(original);
    expect(decompress(compressed).equals(original)).toBe(true);
  });

  it('shrinks repetitive JSONL-like content', () => {
    const original = Buffer.from('{"cwd":"/home/alice/app","type":"user"}\n'.repeat(200));
    const compressed = compress(original);
    expect(compressed.length).toBeLessThan(original.length / 3);
  });

  it('round-trips an empty buffer', () => {
    const original = Buffer.alloc(0);
    expect(decompress(compress(original)).equals(original)).toBe(true);
  });
});
