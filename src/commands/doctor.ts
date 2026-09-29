import { access, stat } from 'node:fs/promises';
import { CONFIG_PATH, loadConfig } from '../lib/config.js';
import { resolveBackend } from '../lib/backend-resolver.js';
import { fetchGitHubUser } from '../storage/github.js';
import { resolveToolPath } from '../adapters/paths.js';
import { isWindows } from '../adapters/paths.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function doctorCommand(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  let config;
  try {
    config = await loadConfig();
    checks.push({ name: 'config', status: 'ok', message: `Config found at ${CONFIG_PATH}` });
  } catch (e) {
    checks.push({ name: 'config', status: 'fail', message: (e as Error).message });
  }

  if (config) {
    if (!isWindows()) {
      try {
        const s = await stat(CONFIG_PATH);
        const mode = s.mode & 0o777;
        if (mode !== 0o600) {
          checks.push({
            name: 'config-permissions',
            status: 'warn',
            message: `Config file mode is ${mode.toString(8)}, expected 600 (contains your storage token). Run: chmod 600 ${CONFIG_PATH}`,
          });
        } else {
          checks.push({ name: 'config-permissions', status: 'ok', message: 'Config file mode is 600' });
        }
      } catch {
        // stat failed after a successful load — unlikely, skip the check rather than crash doctor
      }
    }

    try {
      if (config.storage === 'local' && config.target && !(await pathExists(config.target))) {
        throw new Error(`Local storage target does not exist: ${config.target}`);
      }
      const backend = resolveBackend(config);
      if (config.storage === 'github') await fetchGitHubUser(config.githubToken!);
      await backend.has('__cortex_doctor_probe__');
      checks.push({ name: 'storage', status: 'ok', message: `${backend.name} is reachable` });
    } catch (e) {
      checks.push({ name: 'storage', status: 'fail', message: (e as Error).message });
    }

    if (process.env.CORTEX_PASSPHRASE) {
      checks.push({ name: 'passphrase', status: 'ok', message: 'CORTEX_PASSPHRASE is set' });
    } else {
      checks.push({
        name: 'passphrase',
        status: 'warn',
        message: 'CORTEX_PASSPHRASE is not set — sync/pull/status will prompt for it interactively',
      });
    }

    const missingTools: string[] = [];
    for (const tool of config.tools) {
      if (!(await pathExists(resolveToolPath(tool)))) missingTools.push(tool);
    }
    if (missingTools.length > 0) {
      checks.push({
        name: 'tools',
        status: 'warn',
        message: `Configured but not found on this machine: ${missingTools.join(', ')}`,
      });
    } else {
      checks.push({ name: 'tools', status: 'ok', message: 'All configured tools are present' });
    }
  }

  const ok = checks.every((c) => c.status !== 'fail');

  for (const check of checks) {
    const icon = check.status === 'ok' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
    console.log(`${icon} ${check.name}: ${check.message}`);
  }
  console.log(ok ? '\nAll checks passed.' : '\nSome checks failed — see above.');
  if (!ok) process.exitCode = 1;

  return { checks, ok };
}
