import { describe, it, expect } from 'vitest';
import { encodeProjectPath } from '../../src/lib/path-encoder.js';

describe('encodeProjectPath', () => {
  it('replaces slashes with dashes', () => {
    expect(encodeProjectPath('/home/user/myapp')).toBe('-home-user-myapp');
  });

  it('replaces underscores', () => {
    expect(encodeProjectPath('/home/user/my_app')).toBe('-home-user-my-app');
  });

  it('replaces dots', () => {
    expect(encodeProjectPath('/home/user/.config')).toBe('-home-user--config');
  });

  it('replaces spaces', () => {
    expect(encodeProjectPath('/home/user/my app')).toBe('-home-user-my-app');
  });

  it('replaces unicode chars (accent)', () => {
    // 'é' is multi-byte — every byte outside [a-zA-Z0-9-] becomes a dash
    const encoded = encodeProjectPath('/home/user/Vídeos');
    expect(encoded).toBe('-home-user-V-deos');
  });

  it('preserves dashes and alphanumeric chars', () => {
    expect(encodeProjectPath('/home/user/my-app-123')).toBe('-home-user-my-app-123');
  });

  it('matches Claude Code encoding of a real path', () => {
    // Confirmed experimentally in Fase 0
    expect(encodeProjectPath('/home/sebastiadev/Escritorio/SyncFileMarketPlace')).toBe(
      '-home-sebastiadev-Escritorio-SyncFileMarketPlace',
    );
  });
});
