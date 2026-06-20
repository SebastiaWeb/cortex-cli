# cortex team — Project-Scoped Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `cortex team` commands to operate on the current project directory (`.claude/` in cwd) instead of the global `~/.claude/`, and store the team repo URL in `cortex.json` in the project root instead of in `~/.cortex/config.json`.

**Architecture:** Two small changes drive everything: (1) `LOCAL_SKILLS_DIR` and `LOCAL_CLAUDE_MD` in `claude-skills.ts` switch from `homedir()` to `process.cwd()`, (2) a new `project-config.ts` reads/writes `cortex.json` in cwd for the team repo URL. The four command files are updated to use the project config instead of the global config. The GitHub token still comes from `~/.cortex/config.json` (user-level credential).

**Tech Stack:** TypeScript, Node.js `fs/promises`, `process.cwd()` for project root detection.

---

## File Map

**New files:**
- `src/lib/project-config.ts` — read/write `cortex.json` in cwd (team repo URL)
- `tests/lib/project-config.test.ts`

**Modified files:**
- `src/lib/claude-skills.ts` — swap `homedir()` for `process.cwd()` in constants
- `src/commands/team/init.ts` — use `readProjectConfig`/`writeProjectConfig` instead of `config.teamRepo`
- `src/commands/team/push.ts` — same
- `src/commands/team/pull.ts` — same
- `src/commands/install.ts` — same

**Unchanged files:**
- `src/lib/team-repo.ts`, `src/lib/conflict.ts`, `src/lib/claude-plugins.ts`, `src/cli.ts`, `src/lib/config.ts`

---

## Task 1: Create `src/lib/project-config.ts`

**Files:**
- Create: `src/lib/project-config.ts`
- Create: `tests/lib/project-config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/project-config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readProjectConfig, writeProjectConfig } from '../../src/lib/project-config.js';

describe('project-config', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'cortex-proj-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true });
  });

  it('returns empty object when cortex.json is missing', async () => {
    const result = await readProjectConfig(tmp);
    expect(result).toEqual({});
  });

  it('reads repo from cortex.json', async () => {
    await writeFile(join(tmp, 'cortex.json'), JSON.stringify({ repo: 'https://github.com/user/repo' }));
    const result = await readProjectConfig(tmp);
    expect(result.repo).toBe('https://github.com/user/repo');
  });

  it('writes cortex.json with repo field', async () => {
    await writeProjectConfig({ repo: 'https://github.com/user/repo' }, tmp);
    const raw = JSON.parse(await readFile(join(tmp, 'cortex.json'), 'utf-8'));
    expect(raw.repo).toBe('https://github.com/user/repo');
  });

  it('writeProjectConfig merges into existing cortex.json', async () => {
    await writeFile(join(tmp, 'cortex.json'), JSON.stringify({ projectId: 'my-id', repo: 'old' }));
    await writeProjectConfig({ repo: 'https://github.com/user/new-repo' }, tmp);
    const raw = JSON.parse(await readFile(join(tmp, 'cortex.json'), 'utf-8'));
    expect(raw.projectId).toBe('my-id');
    expect(raw.repo).toBe('https://github.com/user/new-repo');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/project-config.test.ts 2>&1 | tail -10
```

Expected: FAIL — `project-config.js` not found.

- [ ] **Step 3: Create `src/lib/project-config.ts`**

```typescript
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ProjectCortexConfig {
  repo?: string;
  [key: string]: unknown;
}

export async function readProjectConfig(cwd: string = process.cwd()): Promise<ProjectCortexConfig> {
  try {
    const content = await readFile(join(cwd, 'cortex.json'), 'utf-8');
    return JSON.parse(content) as ProjectCortexConfig;
  } catch {
    return {};
  }
}

export async function writeProjectConfig(
  updates: ProjectCortexConfig,
  cwd: string = process.cwd(),
): Promise<void> {
  const existing = await readProjectConfig(cwd);
  const merged = { ...existing, ...updates };
  await writeFile(join(cwd, 'cortex.json'), JSON.stringify(merged, null, 2), 'utf-8');
}
```

- [ ] **Step 4: Run tests — expect 4 passed**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/project-config.test.ts 2>&1 | tail -10
```

Expected: 4 passed.

- [ ] **Step 5: Build**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/lib/project-config.ts tests/lib/project-config.test.ts
git commit -m "feat: add project-config reader/writer for cortex.json in cwd"
```

---

## Task 2: Update `src/lib/claude-skills.ts` constants to use cwd

**Files:**
- Modify: `src/lib/claude-skills.ts`

- [ ] **Step 1: Replace the two constants**

Open `src/lib/claude-skills.ts`. The file currently starts with:

```typescript
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export const LOCAL_SKILLS_DIR = join(homedir(), '.claude', 'skills');
export const LOCAL_CLAUDE_MD = join(homedir(), '.claude', 'CLAUDE.md');
```

Replace with:

```typescript
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export const LOCAL_SKILLS_DIR = join(process.cwd(), '.claude', 'skills');
export const LOCAL_CLAUDE_MD = join(process.cwd(), '.claude', 'CLAUDE.md');
```

(Remove the `homedir` import — it is no longer used.)

- [ ] **Step 2: Run existing claude-skills tests to confirm they still pass**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/claude-skills.test.ts 2>&1 | tail -10
```

Expected: 5 passed (tests use explicit dir params, not the constants — no change needed).

- [ ] **Step 3: Build**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/lib/claude-skills.ts
git commit -m "feat: switch claude-skills constants to project cwd scope"
```

---

## Task 3: Update `src/commands/team/init.ts`

**Files:**
- Modify: `src/commands/team/init.ts`

- [ ] **Step 1: Replace the file with the updated version**

```typescript
import { input } from '@inquirer/prompts';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../../lib/config.js';
import { cloneTeamRepo, commitAndPush, TEAM_DIR } from '../../lib/team-repo.js';
import { readSkillsFromDir, readFileFromPath, LOCAL_SKILLS_DIR, LOCAL_CLAUDE_MD } from '../../lib/claude-skills.js';
import { getInstalledPluginIds } from '../../lib/claude-plugins.js';
import { readProjectConfig, writeProjectConfig } from '../../lib/project-config.js';

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

  const skills = await readSkillsFromDir(LOCAL_SKILLS_DIR);
  if (skills.size > 0) {
    await mkdir(join(TEAM_DIR, 'skills'), { recursive: true });
    for (const [filename, content] of skills) {
      await writeFile(join(TEAM_DIR, 'skills', filename), content, 'utf-8');
    }
    console.log(`  Copied ${skills.size} skills from .claude/skills/`);
  }

  const claudeMd = await readFileFromPath(LOCAL_CLAUDE_MD);
  if (claudeMd) {
    await writeFile(join(TEAM_DIR, 'CLAUDE.md'), claudeMd, 'utf-8');
    console.log('  Copied .claude/CLAUDE.md');
  }

  const plugins = await getInstalledPluginIds();
  const cortexJson = { version: '1', plugins };
  await writeFile(join(TEAM_DIR, 'cortex.json'), JSON.stringify(cortexJson, null, 2), 'utf-8');
  console.log(`  Generated cortex.json (${plugins.length} plugins)`);

  commitAndPush(repoUrl, token, 'feat: initial team Claude Code context');

  await writeProjectConfig({ repo: repoUrl });

  console.log('\n✓ Team repo initialized and pushed.');
  console.log(`  Devs can now run: cortex install --repo ${repoUrl}`);
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
git add src/commands/team/init.ts
git commit -m "feat: team init reads from project .claude/ and saves repo to cortex.json"
```

---

## Task 4: Update `src/commands/team/push.ts`

**Files:**
- Modify: `src/commands/team/push.ts`

- [ ] **Step 1: Replace the file**

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../../lib/config.js';
import { pullTeamRepo, commitAndPush, TEAM_DIR, hasLocalClone } from '../../lib/team-repo.js';
import { readSkillsFromDir, readFileFromPath, LOCAL_SKILLS_DIR, LOCAL_CLAUDE_MD } from '../../lib/claude-skills.js';
import { getInstalledPluginIds } from '../../lib/claude-plugins.js';
import { readProjectConfig } from '../../lib/project-config.js';

export async function teamPushCommand(): Promise<void> {
  const config = await loadConfig();
  const { repo: repoUrl } = await readProjectConfig();
  const token = config.githubToken;
  if (!repoUrl) throw new Error('No team repo configured. Run "cortex team init --repo <url>" first.');
  if (!token) throw new Error('No GitHub token found. Run "cortex init" first.');
  if (!(await hasLocalClone())) throw new Error('No local team clone found. Run "cortex team init" first.');

  console.log('Pulling latest from team repo…');
  pullTeamRepo();

  const skills = await readSkillsFromDir(LOCAL_SKILLS_DIR);
  if (skills.size > 0) {
    await mkdir(join(TEAM_DIR, 'skills'), { recursive: true });
    for (const [filename, content] of skills) {
      await writeFile(join(TEAM_DIR, 'skills', filename), content, 'utf-8');
    }
  }

  const claudeMd = await readFileFromPath(LOCAL_CLAUDE_MD);
  if (claudeMd) {
    await writeFile(join(TEAM_DIR, 'CLAUDE.md'), claudeMd, 'utf-8');
  }

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
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/commands/team/push.ts
git commit -m "feat: team push reads from project .claude/ and cortex.json"
```

---

## Task 5: Update `src/commands/team/pull.ts`

**Files:**
- Modify: `src/commands/team/pull.ts`

- [ ] **Step 1: Replace the file**

```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../../lib/config.js';
import { pullTeamRepo, TEAM_DIR, hasLocalClone } from '../../lib/team-repo.js';
import {
  readSkillsFromDir, writeSkillToDir, readFileFromPath, writeFileToPath,
  LOCAL_SKILLS_DIR, LOCAL_CLAUDE_MD,
} from '../../lib/claude-skills.js';
import { installPlugin } from '../../lib/claude-plugins.js';
import { hasConflict, promptConflict, mergeContent } from '../../lib/conflict.js';
import { readProjectConfig } from '../../lib/project-config.js';

export async function teamPullCommand(): Promise<void> {
  await loadConfig();
  const { repo: repoUrl } = await readProjectConfig();
  if (!repoUrl) throw new Error('No team repo configured. Run "cortex team init --repo <url>" first.');
  if (!(await hasLocalClone())) throw new Error('No local team clone found. Run "cortex install" first.');

  console.log('Pulling from team repo…');
  pullTeamRepo();

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
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/commands/team/pull.ts
git commit -m "feat: team pull writes to project .claude/ using cortex.json repo"
```

---

## Task 6: Update `src/commands/install.ts`

**Files:**
- Modify: `src/commands/install.ts`

- [ ] **Step 1: Replace the file**

```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../lib/config.js';
import { cloneTeamRepo, TEAM_DIR } from '../lib/team-repo.js';
import {
  readSkillsFromDir, writeSkillToDir, readFileFromPath, writeFileToPath,
  LOCAL_SKILLS_DIR, LOCAL_CLAUDE_MD,
} from '../lib/claude-skills.js';
import { installPlugin } from '../lib/claude-plugins.js';
import { readProjectConfig, writeProjectConfig } from '../lib/project-config.js';

export async function installCommand(opts: { repo?: string }): Promise<void> {
  let config;
  try {
    config = await loadConfig();
  } catch {
    throw new Error('Run "cortex init" first to configure your GitHub token.');
  }

  const projectConfig = await readProjectConfig();
  const repoUrl = opts.repo ?? projectConfig.repo;
  if (!repoUrl) {
    throw new Error('No team repo URL. Pass --repo <url> or run "cortex team init" first.');
  }
  const token = config.githubToken;
  if (!token) throw new Error('No GitHub token found. Run "cortex init" first.');

  console.log(`Installing from ${repoUrl} into ${process.cwd()}/.claude/`);
  await cloneTeamRepo(repoUrl, token);

  const skills = await readSkillsFromDir(join(TEAM_DIR, 'skills'));
  for (const [filename, content] of skills) {
    await writeSkillToDir(LOCAL_SKILLS_DIR, filename, content);
    console.log(`  + .claude/skills/${filename}`);
  }

  const claudeMd = await readFileFromPath(join(TEAM_DIR, 'CLAUDE.md'));
  if (claudeMd) {
    await writeFileToPath(LOCAL_CLAUDE_MD, claudeMd);
    console.log('  + .claude/CLAUDE.md');
  }

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

  await writeProjectConfig({ repo: repoUrl });

  console.log('\n✓ Team context installed. Restart Claude Code to activate new skills and plugins.');
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
git add src/commands/install.ts
git commit -m "feat: install writes to project .claude/ and saves repo to cortex.json"
```

---

## Task 7: Full test suite + smoke test + bump to 0.4.1

- [ ] **Step 1: Run full test suite**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run 2>&1 | tail -8
```

Expected: all tests pass (previously 100, now +4 from project-config = 104).

- [ ] **Step 2: Smoke test — verify install writes to project directory**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && node dist/cli.js install --help
```

Expected output includes:
```
Usage: cortex install [options]

First-time install of team Claude context from shared repo

Options:
  --repo <url>  Team config repo URL (overrides stored config)
```

- [ ] **Step 3: Bump to 0.4.1**

In `package.json`, change `"version": "0.4.0"` to `"version": "0.4.1"`.

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -3 && node dist/cli.js --version
```

Expected: `0.4.1`

- [ ] **Step 4: Final commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add package.json
git commit -m "chore: bump to 0.4.1 — project-scoped cortex team"
```
