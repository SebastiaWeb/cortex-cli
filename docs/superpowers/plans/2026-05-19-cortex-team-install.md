# cortex team install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `cortex team init/push/pull` and `cortex install` commands so a Tech Lead can publish their Claude Code setup (skills, CLAUDE.md, plugins) to a GitHub repo and any dev can install it with a single command.

**Architecture:** A dedicated GitHub repo (`claude-config`) is the source of truth for team Claude context. cortex maintains a local git clone at `~/.cortex/team/` and uses `child_process` git calls (same pattern as existing commands) to push/pull changes. Conflict resolution is interactive (Merge / Overwrite / Skip per file).

**Tech Stack:** TypeScript, Node.js `child_process.spawnSync`, `@inquirer/prompts`, Commander subcommand groups, existing `~/.cortex/config.json` for team repo URL.

---

## File Map

**New files:**
- `src/lib/team-repo.ts` — git clone/pull/push wrapper around `~/.cortex/team/`
- `src/lib/claude-skills.ts` — read/write `~/.claude/skills/*.md` and `~/.claude/CLAUDE.md`
- `src/lib/claude-plugins.ts` — read `installed_plugins.json`, install plugin via `claude plugin install`
- `src/lib/conflict.ts` — diff display and M/O/S interactive prompt
- `src/commands/team/init.ts` — `cortex team init --repo <url>`
- `src/commands/team/push.ts` — `cortex team push`
- `src/commands/team/pull.ts` — `cortex team pull`
- `src/commands/install.ts` — `cortex install --repo <url>`
- `tests/lib/conflict.test.ts`
- `tests/lib/claude-skills.test.ts`
- `tests/lib/claude-plugins.test.ts`

**Modified files:**
- `src/commands/init.ts` — add `teamRepo?: string` to `CortexConfig` interface
- `src/cli.ts` — add `team` subcommand group and `install` command

---

## Task 1: Extend CortexConfig with teamRepo

**Files:**
- Modify: `src/commands/init.ts`

- [ ] **Step 1: Add `teamRepo` to the CortexConfig interface**

In `src/commands/init.ts`, find the `CortexConfig` interface (line ~14) and add one field:

```typescript
export interface CortexConfig {
  version: 1;
  storage: StorageBackend;
  email: string;
  target?: string;
  githubToken?: string;
  githubOwner?: string;
  githubRepo?: string;
  teamRepo?: string;      // URL of the shared team config repo
  tools: SupportedTool[];
  createdAt: string;
}
```

- [ ] **Step 2: Build**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/commands/init.ts
git commit -m "feat: add teamRepo field to CortexConfig"
```

---

## Task 2: Implement `src/lib/team-repo.ts`

**Files:**
- Create: `src/lib/team-repo.ts`

This module owns all git operations against `~/.cortex/team/`.

- [ ] **Step 1: Write the failing test** (`tests/lib/team-repo.test.ts`)

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authUrl, hasLocalClone } from '../src/lib/team-repo.js';

describe('team-repo', () => {
  it('authUrl embeds token into https URL', () => {
    const result = authUrl('https://github.com/user/repo', 'ghp_TOKEN');
    expect(result).toBe('https://ghp_TOKEN@github.com/user/repo');
  });

  it('hasLocalClone returns false when dir missing', async () => {
    const result = await hasLocalClone('/nonexistent/path/team');
    expect(result).toBe(false);
  });

  it('hasLocalClone returns false when dir exists but has no .git', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cortex-test-'));
    try {
      const result = await hasLocalClone(tmp);
      expect(result).toBe(false);
    } finally {
      await rm(tmp, { recursive: true });
    }
  });

  it('hasLocalClone returns true when .git dir exists', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cortex-test-'));
    try {
      await mkdir(join(tmp, '.git'));
      const result = await hasLocalClone(tmp);
      expect(result).toBe(true);
    } finally {
      await rm(tmp, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/team-repo.test.ts 2>&1 | tail -10
```

Expected: FAIL — `team-repo.js` not found.

- [ ] **Step 3: Create `src/lib/team-repo.ts`**

```typescript
import { access, mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CORTEX_DIR } from './config.js';

export const TEAM_DIR = join(CORTEX_DIR, 'team');

export function authUrl(repoUrl: string, token: string): string {
  const u = new URL(repoUrl);
  u.username = token;
  u.password = '';
  return u.toString();
}

export async function hasLocalClone(dir: string = TEAM_DIR): Promise<boolean> {
  try {
    await access(join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

export async function cloneTeamRepo(repoUrl: string, token: string): Promise<void> {
  await rm(TEAM_DIR, { recursive: true, force: true });
  await mkdir(CORTEX_DIR, { recursive: true });
  const result = spawnSync(
    'git',
    ['clone', authUrl(repoUrl, token), TEAM_DIR],
    { stdio: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
  );
  if (result.status !== 0) {
    throw new Error(`git clone failed: ${result.stderr?.toString().trim()}`);
  }
}

export function configureGitUser(dir: string = TEAM_DIR): void {
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'cortex@local'], { stdio: 'pipe' });
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'cortex'], { stdio: 'pipe' });
}

export function pullTeamRepo(dir: string = TEAM_DIR): void {
  const result = spawnSync('git', ['-C', dir, 'pull', '--ff-only'], {
    stdio: 'pipe',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.status !== 0) {
    throw new Error(`git pull failed: ${result.stderr?.toString().trim()}`);
  }
}

export function hasPendingChanges(dir: string = TEAM_DIR): boolean {
  const result = spawnSync('git', ['-C', dir, 'status', '--porcelain'], { stdio: 'pipe' });
  return (result.stdout?.toString().trim() ?? '') !== '';
}

export function commitAndPush(repoUrl: string, token: string, message: string, dir: string = TEAM_DIR): void {
  configureGitUser(dir);
  spawnSync('git', ['-C', dir, 'add', '-A'], { stdio: 'pipe' });
  if (!hasPendingChanges(dir)) {
    console.log('Nothing to push — team repo is already up to date.');
    return;
  }
  const commit = spawnSync('git', ['-C', dir, 'commit', '-m', message], { stdio: 'pipe' });
  if (commit.status !== 0) throw new Error('git commit failed');
  const push = spawnSync('git', ['-C', dir, 'push', authUrl(repoUrl, token)], {
    stdio: 'pipe',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (push.status !== 0) {
    throw new Error(`git push failed: ${push.stderr?.toString().trim()}`);
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/team-repo.test.ts 2>&1 | tail -10
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/lib/team-repo.ts tests/lib/team-repo.test.ts
git commit -m "feat: add team-repo git wrapper"
```

---

## Task 3: Implement `src/lib/claude-skills.ts`

**Files:**
- Create: `src/lib/claude-skills.ts`
- Create: `tests/lib/claude-skills.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readSkillsFromDir,
  writeSkillToDir,
  readFileFromPath,
  writeFileToPath,
} from '../src/lib/claude-skills.js';

describe('claude-skills', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'cortex-skills-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true });
  });

  it('readSkillsFromDir returns empty map when dir missing', async () => {
    const result = await readSkillsFromDir(join(tmp, 'nonexistent'));
    expect(result.size).toBe(0);
  });

  it('readSkillsFromDir reads .md files', async () => {
    await writeFile(join(tmp, 'tdd.md'), '# TDD');
    await writeFile(join(tmp, 'debug.md'), '# Debug');
    await writeFile(join(tmp, 'ignore.txt'), 'not a skill');
    const result = await readSkillsFromDir(tmp);
    expect(result.size).toBe(2);
    expect(result.get('tdd.md')).toBe('# TDD');
    expect(result.get('debug.md')).toBe('# Debug');
  });

  it('writeSkillToDir creates directory and writes file', async () => {
    const skillsDir = join(tmp, 'skills');
    await writeSkillToDir(skillsDir, 'new.md', '# New');
    const content = await readFile(join(skillsDir, 'new.md'), 'utf-8');
    expect(content).toBe('# New');
  });

  it('readFileFromPath returns null when file missing', async () => {
    const result = await readFileFromPath(join(tmp, 'missing.md'));
    expect(result).toBeNull();
  });

  it('readFileFromPath returns content when file exists', async () => {
    await writeFile(join(tmp, 'claude.md'), '# Project');
    const result = await readFileFromPath(join(tmp, 'claude.md'));
    expect(result).toBe('# Project');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/claude-skills.test.ts 2>&1 | tail -10
```

Expected: FAIL — `claude-skills.js` not found.

- [ ] **Step 3: Create `src/lib/claude-skills.ts`**

```typescript
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LOCAL_SKILLS_DIR = join(homedir(), '.claude', 'skills');
export const LOCAL_CLAUDE_MD = join(homedir(), '.claude', 'CLAUDE.md');

export async function readSkillsFromDir(dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return map;
  }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.md')) {
      const content = await readFile(join(dir, e.name), 'utf-8');
      map.set(e.name, content);
    }
  }
  return map;
}

export async function writeSkillToDir(dir: string, filename: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), content, 'utf-8');
}

export async function readFileFromPath(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function writeFileToPath(filePath: string, content: string): Promise<void> {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/claude-skills.test.ts 2>&1 | tail -10
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/lib/claude-skills.ts tests/lib/claude-skills.test.ts
git commit -m "feat: add claude-skills read/write helpers"
```

---

## Task 4: Implement `src/lib/claude-plugins.ts`

**Files:**
- Create: `src/lib/claude-plugins.ts`
- Create: `tests/lib/claude-plugins.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseInstalledPlugins } from '../src/lib/claude-plugins.js';

describe('claude-plugins', () => {
  it('returns empty array for empty plugins object', () => {
    const result = parseInstalledPlugins({ version: 2, plugins: {} });
    expect(result).toEqual([]);
  });

  it('returns plugin identifiers from installed_plugins.json shape', () => {
    const data = {
      version: 2,
      plugins: {
        'superpowers@claude-plugins-official': [{ scope: 'user' }],
        'context7@claude-plugins-official': [{ scope: 'user' }],
      },
    };
    const result = parseInstalledPlugins(data);
    expect(result).toContain('superpowers@claude-plugins-official');
    expect(result).toContain('context7@claude-plugins-official');
    expect(result).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/claude-plugins.test.ts 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Step 3: Create `src/lib/claude-plugins.ts`**

```typescript
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const INSTALLED_PLUGINS_PATH = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');

interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, unknown[]>;
}

export function parseInstalledPlugins(data: InstalledPluginsFile): string[] {
  return Object.keys(data.plugins);
}

export async function getInstalledPluginIds(): Promise<string[]> {
  try {
    const buf = await readFile(INSTALLED_PLUGINS_PATH, 'utf-8');
    return parseInstalledPlugins(JSON.parse(buf) as InstalledPluginsFile);
  } catch {
    return [];
  }
}

export function installPlugin(pluginId: string): void {
  console.log(`Installing plugin: ${pluginId}`);
  const result = spawnSync('claude', ['plugin', 'install', pluginId], { stdio: 'inherit' });
  if (result.error) throw new Error(`Failed to run claude: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Plugin install failed for ${pluginId}`);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/claude-plugins.test.ts 2>&1 | tail -10
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/lib/claude-plugins.ts tests/lib/claude-plugins.test.ts
git commit -m "feat: add claude-plugins read and install helpers"
```

---

## Task 5: Implement `src/lib/conflict.ts`

**Files:**
- Create: `src/lib/conflict.ts`
- Create: `tests/lib/conflict.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { hasConflict, mergeContent, buildDiffLines } from '../src/lib/conflict.js';

describe('conflict', () => {
  it('hasConflict returns false when files are identical', () => {
    expect(hasConflict('# TDD\nWrite tests first.', '# TDD\nWrite tests first.')).toBe(false);
  });

  it('hasConflict returns true when files differ', () => {
    expect(hasConflict('# TDD', '# TDD\nExtra line.')).toBe(true);
  });

  it('mergeContent returns local when remote adds nothing new', () => {
    const local = '# TDD\nWrite tests first.';
    expect(mergeContent(local, local)).toBe(local);
  });

  it('mergeContent appends remote-only lines to local', () => {
    const local = '# TDD\nWrite tests first.';
    const remote = '# TDD\nWrite tests first.\nPrefer unit tests.';
    const result = mergeContent(local, remote);
    expect(result).toContain('Write tests first.');
    expect(result).toContain('Prefer unit tests.');
  });

  it('buildDiffLines tags same/local/remote lines correctly', () => {
    const diff = buildDiffLines('shared\nlocal-only', 'shared\nremote-only');
    const shared = diff.filter(d => d.type === 'same');
    const localOnly = diff.filter(d => d.type === 'local');
    const remoteOnly = diff.filter(d => d.type === 'remote');
    expect(shared.some(d => d.line === 'shared')).toBe(true);
    expect(localOnly.some(d => d.line === 'local-only')).toBe(true);
    expect(remoteOnly.some(d => d.line === 'remote-only')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/conflict.test.ts 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Step 3: Create `src/lib/conflict.ts`**

```typescript
import { select } from '@inquirer/prompts';

export type DiffLine = { type: 'same' | 'local' | 'remote'; line: string };

export function hasConflict(local: string, remote: string): boolean {
  return local.trim() !== remote.trim();
}

export function buildDiffLines(local: string, remote: string): DiffLine[] {
  const localLines = local.split('\n');
  const remoteLines = remote.split('\n');
  const localSet = new Set(localLines);
  const remoteSet = new Set(remoteLines);
  const all = [...new Set([...localLines, ...remoteLines])];
  return all.map(line => ({
    type: localSet.has(line) && remoteSet.has(line) ? 'same'
        : localSet.has(line) ? 'local'
        : 'remote',
    line,
  }));
}

export function mergeContent(local: string, remote: string): string {
  const localSet = new Set(local.split('\n'));
  const additions = remote.split('\n').filter(l => !localSet.has(l) && l.trim() !== '');
  if (additions.length === 0) return local;
  return local.trimEnd() + '\n\n' + additions.join('\n');
}

export function displayDiff(filename: string, local: string, remote: string): void {
  const diff = buildDiffLines(local, remote);
  console.log(`\n⚠  Conflict: ${filename}`);
  console.log('─'.repeat(50));
  for (const d of diff) {
    if (d.type === 'local') console.log(`  - ${d.line}`);
    else if (d.type === 'remote') console.log(`  + ${d.line}`);
  }
  console.log('─'.repeat(50));
}

export async function promptConflict(
  filename: string,
  local: string,
  remote: string,
): Promise<'merge' | 'overwrite' | 'skip'> {
  displayDiff(filename, local, remote);
  return select({
    message: 'How to resolve?',
    choices: [
      { name: '[M] Merge — keep both versions', value: 'merge' },
      { name: '[O] Overwrite — use team version', value: 'overwrite' },
      { name: '[S] Skip — keep local version', value: 'skip' },
    ],
  });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/conflict.test.ts 2>&1 | tail -10
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/lib/conflict.ts tests/lib/conflict.test.ts
git commit -m "feat: add conflict diff display and resolution prompt"
```

---

## Task 6: Implement `src/commands/team/init.ts`

**Files:**
- Create: `src/commands/team/init.ts`

- [ ] **Step 1: Create `src/commands/team/init.ts`**

```typescript
import { input } from '@inquirer/prompts';
import { writeFile, mkdir, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, CONFIG_PATH, CORTEX_DIR } from '../../lib/config.js';
import { cloneTeamRepo, commitAndPush, TEAM_DIR } from '../../lib/team-repo.js';
import { readSkillsFromDir, readFileFromPath, LOCAL_SKILLS_DIR, LOCAL_CLAUDE_MD } from '../../lib/claude-skills.js';
import { getInstalledPluginIds } from '../../lib/claude-plugins.js';
import { readFile } from 'node:fs/promises';

export async function teamInitCommand(opts: { repo?: string }): Promise<void> {
  const config = await loadConfig();

  const repoUrl = opts.repo ?? await input({
    message: 'Team config repo URL (https://github.com/user/claude-config):',
    validate: (v) => v.startsWith('https://') || 'Must be an https URL',
  });

  const token = config.githubToken;
  if (!token) throw new Error('No GitHub token found. Run "cortex init" first with GitHub storage.');

  console.log(`\nCloning ${repoUrl} → ~/.cortex/team/`);
  await cloneTeamRepo(repoUrl, token);

  // Copy skills
  const skills = await readSkillsFromDir(LOCAL_SKILLS_DIR);
  if (skills.size > 0) {
    await mkdir(join(TEAM_DIR, 'skills'), { recursive: true });
    for (const [filename, content] of skills) {
      await writeFile(join(TEAM_DIR, 'skills', filename), content, 'utf-8');
    }
    console.log(`  Copied ${skills.size} skills`);
  }

  // Copy CLAUDE.md
  const claudeMd = await readFileFromPath(LOCAL_CLAUDE_MD);
  if (claudeMd) {
    await writeFile(join(TEAM_DIR, 'CLAUDE.md'), claudeMd, 'utf-8');
    console.log('  Copied CLAUDE.md');
  }

  // Generate cortex.json
  const plugins = await getInstalledPluginIds();
  const cortexJson = { version: '1', plugins };
  await writeFile(join(TEAM_DIR, 'cortex.json'), JSON.stringify(cortexJson, null, 2), 'utf-8');
  console.log(`  Generated cortex.json (${plugins.length} plugins)`);

  commitAndPush(repoUrl, token, 'feat: initial team Claude Code context');

  // Save teamRepo to config
  const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
  raw.teamRepo = repoUrl;
  await writeFile(CONFIG_PATH, JSON.stringify(raw, null, 2), 'utf-8');

  console.log('\n✓ Team repo initialized and pushed.');
  console.log(`  Devs can now run: cortex install --repo ${repoUrl}`);
}
```

- [ ] **Step 2: Build**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/commands/team/init.ts
git commit -m "feat: add cortex team init command"
```

---

## Task 7: Implement `src/commands/team/push.ts`

**Files:**
- Create: `src/commands/team/push.ts`

- [ ] **Step 1: Create `src/commands/team/push.ts`**

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../../lib/config.js';
import { pullTeamRepo, commitAndPush, TEAM_DIR, hasLocalClone } from '../../lib/team-repo.js';
import { readSkillsFromDir, readFileFromPath, LOCAL_SKILLS_DIR, LOCAL_CLAUDE_MD } from '../../lib/claude-skills.js';
import { getInstalledPluginIds } from '../../lib/claude-plugins.js';

export async function teamPushCommand(): Promise<void> {
  const config = await loadConfig();
  const repoUrl = config.teamRepo;
  const token = config.githubToken;
  if (!repoUrl) throw new Error('No team repo configured. Run "cortex team init --repo <url>" first.');
  if (!token) throw new Error('No GitHub token found. Run "cortex init" first.');
  if (!(await hasLocalClone())) throw new Error('No local team clone found. Run "cortex team init" first.');

  console.log('Pulling latest from team repo…');
  pullTeamRepo();

  // Sync skills
  const skills = await readSkillsFromDir(LOCAL_SKILLS_DIR);
  if (skills.size > 0) {
    await mkdir(join(TEAM_DIR, 'skills'), { recursive: true });
    for (const [filename, content] of skills) {
      await writeFile(join(TEAM_DIR, 'skills', filename), content, 'utf-8');
    }
  }

  // Sync CLAUDE.md
  const claudeMd = await readFileFromPath(LOCAL_CLAUDE_MD);
  if (claudeMd) {
    await writeFile(join(TEAM_DIR, 'CLAUDE.md'), claudeMd, 'utf-8');
  }

  // Update cortex.json
  const plugins = await getInstalledPluginIds();
  await writeFile(
    join(TEAM_DIR, 'cortex.json'),
    JSON.stringify({ version: '1', plugins }, null, 2),
    'utf-8',
  );

  commitAndPush(repoUrl, token, 'chore: update team Claude Code context');
  console.log('\n✓ Pushed to team repo.');
}
```

- [ ] **Step 2: Build**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/commands/team/push.ts
git commit -m "feat: add cortex team push command"
```

---

## Task 8: Implement `src/commands/team/pull.ts`

**Files:**
- Create: `src/commands/team/pull.ts`

- [ ] **Step 1: Create `src/commands/team/pull.ts`**

```typescript
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../../lib/config.js';
import { pullTeamRepo, TEAM_DIR, hasLocalClone } from '../../lib/team-repo.js';
import {
  readSkillsFromDir, writeSkillToDir, readFileFromPath, writeFileToPath,
  LOCAL_SKILLS_DIR, LOCAL_CLAUDE_MD,
} from '../../lib/claude-skills.js';
import { installPlugin } from '../../lib/claude-plugins.js';
import { hasConflict, promptConflict, mergeContent } from '../../lib/conflict.js';

export async function teamPullCommand(): Promise<void> {
  const config = await loadConfig();
  const repoUrl = config.teamRepo;
  if (!repoUrl) throw new Error('No team repo configured. Run "cortex team init --repo <url>" first.');
  if (!(await hasLocalClone())) throw new Error('No local team clone found. Run "cortex install" first.');

  console.log('Pulling from team repo…');
  pullTeamRepo();

  // Install skills with conflict resolution
  const remoteSkills = await readSkillsFromDir(join(TEAM_DIR, 'skills'));
  const localSkills = await readSkillsFromDir(LOCAL_SKILLS_DIR);

  for (const [filename, remoteContent] of remoteSkills) {
    const localContent = localSkills.get(filename) ?? null;
    if (!localContent) {
      await writeSkillToDir(LOCAL_SKILLS_DIR, filename, remoteContent);
      console.log(`  + ${filename} (new)`);
      continue;
    }
    if (!hasConflict(localContent, remoteContent)) continue;
    const resolution = await promptConflict(filename, localContent, remoteContent);
    if (resolution === 'overwrite') {
      await writeSkillToDir(LOCAL_SKILLS_DIR, filename, remoteContent);
      console.log(`  ✓ ${filename} overwritten`);
    } else if (resolution === 'merge') {
      await writeSkillToDir(LOCAL_SKILLS_DIR, filename, mergeContent(localContent, remoteContent));
      console.log(`  ✓ ${filename} merged`);
    } else {
      console.log(`  ~ ${filename} skipped`);
    }
  }

  // Sync CLAUDE.md
  const remoteMd = await readFileFromPath(join(TEAM_DIR, 'CLAUDE.md'));
  if (remoteMd) {
    const localMd = await readFileFromPath(LOCAL_CLAUDE_MD);
    if (!localMd) {
      await writeFileToPath(LOCAL_CLAUDE_MD, remoteMd);
      console.log('  + CLAUDE.md (new)');
    } else if (hasConflict(localMd, remoteMd)) {
      const resolution = await promptConflict('CLAUDE.md', localMd, remoteMd);
      if (resolution === 'overwrite') {
        await writeFileToPath(LOCAL_CLAUDE_MD, remoteMd);
        console.log('  ✓ CLAUDE.md overwritten');
      } else if (resolution === 'merge') {
        await writeFileToPath(LOCAL_CLAUDE_MD, mergeContent(localMd, remoteMd));
        console.log('  ✓ CLAUDE.md merged');
      } else {
        console.log('  ~ CLAUDE.md skipped');
      }
    }
  }

  // Install plugins (additive)
  let cortexJson: { plugins?: string[] } = {};
  try {
    cortexJson = JSON.parse(await readFile(join(TEAM_DIR, 'cortex.json'), 'utf-8'));
  } catch { /* no cortex.json is fine */ }

  for (const pluginId of cortexJson.plugins ?? []) {
    try {
      installPlugin(pluginId);
    } catch (e) {
      console.warn(`  ⚠ Could not install ${pluginId}: ${(e as Error).message}`);
    }
  }

  console.log('\n✓ Team context applied.');
}
```

- [ ] **Step 2: Build**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/commands/team/pull.ts
git commit -m "feat: add cortex team pull command with conflict resolution"
```

---

## Task 9: Implement `src/commands/install.ts`

**Files:**
- Create: `src/commands/install.ts`

First-time install — no conflict prompts, just overwrite everything.

- [ ] **Step 1: Create `src/commands/install.ts`**

```typescript
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, CONFIG_PATH } from '../lib/config.js';
import { cloneTeamRepo, TEAM_DIR } from '../lib/team-repo.js';
import { readSkillsFromDir, writeSkillToDir, readFileFromPath, writeFileToPath, LOCAL_SKILLS_DIR, LOCAL_CLAUDE_MD } from '../lib/claude-skills.js';
import { installPlugin } from '../lib/claude-plugins.js';

export async function installCommand(opts: { repo?: string }): Promise<void> {
  let config;
  try {
    config = await loadConfig();
  } catch {
    throw new Error('Run "cortex init" first to configure your GitHub token.');
  }

  const repoUrl = opts.repo ?? config.teamRepo;
  if (!repoUrl) {
    throw new Error('No team repo URL. Pass --repo <url> or run "cortex team init" first.');
  }
  const token = config.githubToken;
  if (!token) throw new Error('No GitHub token found. Run "cortex init" first.');

  console.log(`Installing from ${repoUrl}…`);
  await cloneTeamRepo(repoUrl, token);

  // Install skills (overwrite, no conflict prompt on first install)
  const skills = await readSkillsFromDir(join(TEAM_DIR, 'skills'));
  for (const [filename, content] of skills) {
    await writeSkillToDir(LOCAL_SKILLS_DIR, filename, content);
    console.log(`  + ${filename}`);
  }

  // Install CLAUDE.md
  const claudeMd = await readFileFromPath(join(TEAM_DIR, 'CLAUDE.md'));
  if (claudeMd) {
    await writeFileToPath(LOCAL_CLAUDE_MD, claudeMd);
    console.log('  + CLAUDE.md');
  }

  // Install plugins
  let cortexJson: { plugins?: string[] } = {};
  try {
    cortexJson = JSON.parse(await readFile(join(TEAM_DIR, 'cortex.json'), 'utf-8'));
  } catch { /* ok */ }

  for (const pluginId of cortexJson.plugins ?? []) {
    try {
      installPlugin(pluginId);
    } catch (e) {
      console.warn(`  ⚠ Could not install ${pluginId}: ${(e as Error).message}`);
    }
  }

  // Save teamRepo to config
  const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
  raw.teamRepo = repoUrl;
  await writeFile(CONFIG_PATH, JSON.stringify(raw, null, 2), 'utf-8');

  console.log('\n✓ Team context installed. Restart Claude Code to activate new skills and plugins.');
}
```

- [ ] **Step 2: Build**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/commands/install.ts
git commit -m "feat: add cortex install command for first-time team setup"
```

---

## Task 10: Wire CLI in `src/cli.ts`

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Update `src/cli.ts`**

Add these imports at the top (after existing imports):

```typescript
import { teamInitCommand } from './commands/team/init.js';
import { teamPushCommand } from './commands/team/push.js';
import { teamPullCommand } from './commands/team/pull.js';
import { installCommand } from './commands/install.js';
```

Add these commands before the final `await program.parseAsync(process.argv)`:

```typescript
const team = program
  .command('team')
  .description('Share Claude Code context with your team');

team
  .command('init')
  .description('Publish your Claude setup to a shared GitHub repo')
  .option('--repo <url>', 'Team config repo URL (https://github.com/user/claude-config)')
  .action((opts) => void teamInitCommand(opts));

team
  .command('push')
  .description('Push local skill/CLAUDE.md/plugin changes to the team repo')
  .action(() => void teamPushCommand());

team
  .command('pull')
  .description('Pull team context updates and install with conflict resolution')
  .action(() => void teamPullCommand());

program
  .command('install')
  .description('First-time install of team Claude context from shared repo')
  .option('--repo <url>', 'Team config repo URL (overrides stored config)')
  .action((opts) => void installCommand(opts));
```

- [ ] **Step 2: Build**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Verify commands appear**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && node dist/cli.js --help && echo "---" && node dist/cli.js team --help
```

Expected: `install` and `team` appear in top-level help. `init`, `push`, `pull` appear under `team`.

- [ ] **Step 4: Run all tests**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/cli.ts
git commit -m "feat: wire cortex team and install commands into CLI"
```

---

## Task 11: Manual smoke test

- [ ] **Step 1: Verify help output looks correct**

```bash
node /home/sebastiadev/Escritorio/cortex-cli/dist/cli.js team --help
```

Expected output:
```
Usage: cortex team [options] [command]

Share Claude Code context with your team

Commands:
  init [options]  Publish your Claude setup to a shared GitHub repo
  push            Push local skill/CLAUDE.md/plugin changes to the team repo
  pull            Pull team context updates and install with conflict resolution

Options:
  -h, --help  display help for command
```

- [ ] **Step 2: Verify install command**

```bash
node /home/sebastiadev/Escritorio/cortex-cli/dist/cli.js install --help
```

Expected:
```
Usage: cortex install [options]

First-time install of team Claude context from shared repo

Options:
  --repo <url>  Team config repo URL (overrides stored config)
  -h, --help    display help for command
```

- [ ] **Step 3: Bump version and build**

In `package.json`, bump version to `0.4.0`. Then:

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build && node dist/cli.js --version
```

Expected: `0.4.0`

- [ ] **Step 4: Final commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add package.json
git commit -m "chore: bump to 0.4.0 — cortex team install"
```
