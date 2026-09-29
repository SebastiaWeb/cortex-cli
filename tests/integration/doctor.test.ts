import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { doctorCommand as DoctorCommandFn } from '../../src/commands/doctor.js';

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    } as Response;
  });
}

describe('cortex doctor', () => {
  let claudeHome: string;
  let doctorCommand: typeof DoctorCommandFn;
  const email = 'dev@example.com';

  beforeEach(async () => {
    claudeHome = await mkdtemp(join(tmpdir(), 'cortex-home-'));
    vi.stubEnv('HOME', claudeHome);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    await rm(claudeHome, { recursive: true, force: true });
  });

  async function writeConfig(config: Record<string, unknown>, mode = 0o600) {
    await mkdir(join(claudeHome, '.cortex'), { recursive: true });
    const path = join(claudeHome, '.cortex', 'config.json');
    await writeFile(path, JSON.stringify(config));
    await chmod(path, mode);
  }

  it('fails the config check when no config exists', async () => {
    vi.resetModules();
    ({ doctorCommand } = await import('../../src/commands/doctor.js'));
    const report = await doctorCommand();
    expect(report.ok).toBe(false);
    const configCheck = report.checks.find((c) => c.name === 'config');
    expect(configCheck?.status).toBe('fail');
  });

  it('passes everything for a valid local-storage config with an existing target', async () => {
    const target = await mkdtemp(join(tmpdir(), 'cortex-target-'));
    await writeConfig({
      version: 1, storage: 'local', email, target, tools: [], createdAt: new Date().toISOString(),
    });

    vi.resetModules();
    ({ doctorCommand } = await import('../../src/commands/doctor.js'));
    const report = await doctorCommand();

    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.status !== 'fail')).toBe(true);
    await rm(target, { recursive: true, force: true });
  });

  it('fails the storage check when the local target does not exist', async () => {
    await writeConfig({
      version: 1, storage: 'local', email, target: '/nonexistent/path/for/doctor/test', tools: [], createdAt: new Date().toISOString(),
    });

    vi.resetModules();
    ({ doctorCommand } = await import('../../src/commands/doctor.js'));
    const report = await doctorCommand();

    expect(report.ok).toBe(false);
    const storageCheck = report.checks.find((c) => c.name === 'storage');
    expect(storageCheck?.status).toBe('fail');
  });

  it('warns when the config file has looser permissions than 600', async () => {
    const target = await mkdtemp(join(tmpdir(), 'cortex-target-'));
    await writeConfig({
      version: 1, storage: 'local', email, target, tools: [], createdAt: new Date().toISOString(),
    }, 0o644);

    vi.resetModules();
    ({ doctorCommand } = await import('../../src/commands/doctor.js'));
    const report = await doctorCommand();

    const permCheck = report.checks.find((c) => c.name === 'config-permissions');
    expect(permCheck?.status).toBe('warn');
    await rm(target, { recursive: true, force: true });
  });

  it('passes the storage check for github when the token is valid and the repo is reachable', async () => {
    await writeConfig({
      version: 1, storage: 'github', email, tools: [], createdAt: new Date().toISOString(),
      githubToken: 'ghp_test', githubOwner: 'testuser', githubRepo: 'cortex-backup',
    });
    vi.stubGlobal('fetch', mockFetch([{ status: 200, body: { login: 'testuser' } }, { status: 404, body: {} }]));

    vi.resetModules();
    ({ doctorCommand } = await import('../../src/commands/doctor.js'));
    const report = await doctorCommand();

    const storageCheck = report.checks.find((c) => c.name === 'storage');
    expect(storageCheck?.status).toBe('ok');
  });

  it('fails the storage check for github when the token is invalid', async () => {
    await writeConfig({
      version: 1, storage: 'github', email, tools: [], createdAt: new Date().toISOString(),
      githubToken: 'ghp_bad', githubOwner: 'testuser', githubRepo: 'cortex-backup',
    });
    vi.stubGlobal('fetch', mockFetch([{ status: 401, body: { message: 'Bad credentials' } }]));

    vi.resetModules();
    ({ doctorCommand } = await import('../../src/commands/doctor.js'));
    const report = await doctorCommand();

    const storageCheck = report.checks.find((c) => c.name === 'storage');
    expect(storageCheck?.status).toBe('fail');
    expect(report.ok).toBe(false);
  });

  it('warns when CORTEX_PASSPHRASE is not set', async () => {
    const target = await mkdtemp(join(tmpdir(), 'cortex-target-'));
    await writeConfig({
      version: 1, storage: 'local', email, target, tools: [], createdAt: new Date().toISOString(),
    });
    vi.stubEnv('CORTEX_PASSPHRASE', '');
    delete process.env.CORTEX_PASSPHRASE;

    vi.resetModules();
    ({ doctorCommand } = await import('../../src/commands/doctor.js'));
    const report = await doctorCommand();

    const passphraseCheck = report.checks.find((c) => c.name === 'passphrase');
    expect(passphraseCheck?.status).toBe('warn');
    await rm(target, { recursive: true, force: true });
  });

  it('warns about a configured tool whose directory is missing', async () => {
    const target = await mkdtemp(join(tmpdir(), 'cortex-target-'));
    await writeConfig({
      version: 1, storage: 'local', email, target, tools: ['claude-code'], createdAt: new Date().toISOString(),
    });
    // claudeHome (stubbed as HOME) has no .claude dir created

    vi.resetModules();
    ({ doctorCommand } = await import('../../src/commands/doctor.js'));
    const report = await doctorCommand();

    const toolsCheck = report.checks.find((c) => c.name === 'tools');
    expect(toolsCheck?.status).toBe('warn');
    await rm(target, { recursive: true, force: true });
  });
});
