# cortex team sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow team members to optionally share Claude Code chat sessions via the team repo, with one-time consent, configurable AES-256-GCM encryption, and automatic path remapping on pull so Claude Code displays all team sessions natively.

**Architecture:** A new `src/lib/team-sessions.ts` module handles all session I/O (read from `~/.claude/projects/`, copy to/from `team-repo/sessions/<email>/<project-id>/`, encrypt/decrypt, remap paths). `team/init.ts` gains a one-time consent prompt that writes `shareSession`/`encryptSessions` to `cortex.json`. `team/push.ts` and `team/pull.ts` call into the module when enabled. The encryption key is derived from `deriveKey(teamPassphrase, repoUrl)` — the repo URL is the salt so all devs with the same passphrase get the same key.

**Tech Stack:** TypeScript, Node.js `fs/promises`, existing `crypto.ts` (AES-256-GCM), `jsonl-remapper.ts` (path remap), `project-identifier.ts` (project ID), `path-encoder.ts` (Claude session dir name), `@inquirer/prompts` (consent + passphrase UI).

---

## File Map

**New files:**
- `src/lib/team-sessions.ts` — all session logic (read, push, pull, encrypt, remap)
- `tests/lib/team-sessions.test.ts` — unit tests for the module

**Modified files:**
- `src/lib/project-config.ts` — add `shareSession?: boolean`, `encryptSessions?: boolean` to `ProjectCortexConfig`
- `src/commands/team/init.ts` — add consent + encryption prompts after existing flow
- `src/commands/team/push.ts` — call `pushSessions` when `shareSession: true`
- `src/commands/team/pull.ts` — call `pullSessions` (silent if no sessions in repo)
- `README.md` — document team sessions feature

**Unchanged:**
- `src/lib/crypto.ts`, `src/lib/jsonl-remapper.ts`, `src/lib/project-identifier.ts`, `src/lib/path-encoder.ts`, `src/lib/team-repo.ts`, `src/cli.ts`

---

## Task 1: Update `ProjectCortexConfig` type

**Files:**
- Modify: `src/lib/project-config.ts`
- Modify: `tests/lib/project-config.test.ts`

- [ ] **Step 1: Add the two new optional fields to the interface**

Open `src/lib/project-config.ts`. The `ProjectCortexConfig` interface currently reads:

```typescript
export interface ProjectCortexConfig {
  repo?: string;
  [key: string]: unknown;
}
```

Replace with:

```typescript
export interface ProjectCortexConfig {
  repo?: string;
  shareSession?: boolean;
  encryptSessions?: boolean;
  [key: string]: unknown;
}
```

No function changes needed — `writeProjectConfig` already merges arbitrary keys.

- [ ] **Step 2: Add a test for the new fields**

Open `tests/lib/project-config.test.ts`. Append inside the `describe` block:

```typescript
  it('round-trips shareSession and encryptSessions', async () => {
    await writeProjectConfig({ repo: 'https://github.com/u/r', shareSession: true, encryptSessions: false }, tmp);
    const result = await readProjectConfig(tmp);
    expect(result.shareSession).toBe(true);
    expect(result.encryptSessions).toBe(false);
  });
```

- [ ] **Step 3: Run tests**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/project-config.test.ts 2>&1 | tail -5
```

Expected: 5 passed.

- [ ] **Step 4: Build**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/lib/project-config.ts tests/lib/project-config.test.ts
git commit -m "feat: add shareSession and encryptSessions fields to ProjectCortexConfig"
```

---

## Task 2: Create `src/lib/team-sessions.ts`

**Files:**
- Create: `src/lib/team-sessions.ts`
- Create: `tests/lib/team-sessions.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/team-sessions.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { encodeProjectPath } from '../../src/lib/path-encoder.js';
import { deriveKey } from '../../src/lib/crypto.js';
import {
  localSessionsDir,
  teamSessionsDir,
  readSessionFiles,
  copySessionsToTeamDir,
  copySessionsFromRepo,
} from '../../src/lib/team-sessions.js';

const TEAM_DIR_PLACEHOLDER = '/tmp/fake-team-dir'; // overridden per test

describe('localSessionsDir', () => {
  it('encodes cwd into claude projects path', () => {
    const result = localSessionsDir('/home/alice/myapp');
    expect(result).toBe(join(homedir(), '.claude', 'projects', encodeProjectPath('/home/alice/myapp')));
  });
});

describe('teamSessionsDir', () => {
  it('builds path with email and projectId', () => {
    const result = teamSessionsDir('/some/base', 'alice@co.com', 'my-project-id');
    expect(result).toBe(join('/some/base', 'sessions', 'alice@co.com', 'my-project-id'));
  });
});

describe('readSessionFiles', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'cortex-sess-')); });
  afterEach(async () => { await rm(tmp, { recursive: true }); });

  it('returns empty map for missing directory', async () => {
    const result = await readSessionFiles('/nonexistent/path/xyz');
    expect(result.size).toBe(0);
  });

  it('reads only .jsonl files, ignores others', async () => {
    await writeFile(join(tmp, 'abc.jsonl'), 'session1');
    await writeFile(join(tmp, 'def.jsonl'), 'session2');
    await writeFile(join(tmp, 'readme.txt'), 'skip');
    await writeFile(join(tmp, 'abc.jsonl.enc'), 'skip-enc');
    const result = await readSessionFiles(tmp);
    expect(result.size).toBe(2);
    expect(result.has('abc.jsonl')).toBe(true);
    expect(result.has('def.jsonl')).toBe(true);
  });
});

describe('copySessionsToTeamDir', () => {
  let src: string;
  let dest: string;
  beforeEach(async () => {
    src = await mkdtemp(join(tmpdir(), 'cortex-src-'));
    dest = await mkdtemp(join(tmpdir(), 'cortex-dest-'));
  });
  afterEach(async () => {
    await rm(src, { recursive: true });
    await rm(dest, { recursive: true });
  });

  it('copies plain sessions when no derived key provided', async () => {
    await writeFile(join(src, 'abc.jsonl'), '{"cwd":"/old/path"}');
    const count = await copySessionsToTeamDir(src, dest);
    expect(count).toBe(1);
    const written = await readFile(join(dest, 'abc.jsonl'), 'utf-8');
    expect(written).toBe('{"cwd":"/old/path"}');
  });

  it('returns 0 when source dir is empty', async () => {
    const count = await copySessionsToTeamDir(src, dest);
    expect(count).toBe(0);
  });

  it('encrypts sessions when derived key is provided', async () => {
    await writeFile(join(src, 'abc.jsonl'), '{"cwd":"/old/path"}');
    const derived = deriveKey('passphrase-12chars', 'test@test.com');
    const count = await copySessionsToTeamDir(src, dest, derived);
    expect(count).toBe(1);
    // Written as .enc, not readable as plain text
    const encFile = await readFile(join(dest, 'abc.jsonl.enc'));
    expect(encFile.toString('utf-8')).not.toBe('{"cwd":"/old/path"}');
  });
});

describe('copySessionsFromRepo', () => {
  let sessionsRoot: string;
  let dest: string;
  beforeEach(async () => {
    sessionsRoot = await mkdtemp(join(tmpdir(), 'cortex-repo-'));
    dest = await mkdtemp(join(tmpdir(), 'cortex-local-'));
  });
  afterEach(async () => {
    await rm(sessionsRoot, { recursive: true });
    await rm(dest, { recursive: true });
  });

  it('returns 0 when no sessions dir exists', async () => {
    const count = await copySessionsFromRepo('/nonexistent', 'proj-id', dest, '/local/cwd');
    expect(count).toBe(0);
  });

  it('copies and remaps paths from team repo to local dir', async () => {
    const devDir = join(sessionsRoot, 'alice@co.com', 'proj-id');
    await mkdir(devDir, { recursive: true });
    const session = JSON.stringify({ cwd: '/remote/path', type: 'user' });
    await writeFile(join(devDir, 'abc.jsonl'), session);

    const count = await copySessionsFromRepo(sessionsRoot, 'proj-id', dest, '/local/cwd');
    expect(count).toBe(1);
    const written = JSON.parse(await readFile(join(dest, 'abc.jsonl'), 'utf-8')) as { cwd: string };
    expect(written.cwd).toBe('/local/cwd');
  });

  it('suffixes filename when collision from second dev', async () => {
    // Alice and Bob both have abc.jsonl for the same project
    for (const dev of ['alice@co.com', 'bob@co.com']) {
      const devDir = join(sessionsRoot, dev, 'proj-id');
      await mkdir(devDir, { recursive: true });
      await writeFile(join(devDir, 'abc.jsonl'), JSON.stringify({ cwd: '/remote', type: 'user' }));
    }

    const count = await copySessionsFromRepo(sessionsRoot, 'proj-id', dest, '/local/cwd');
    expect(count).toBe(2);
    // One goes to abc.jsonl, the other to abc.bob.jsonl (or abc.ali.jsonl)
    const files = await readSessionFiles(dest);
    expect(files.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/team-sessions.test.ts 2>&1 | tail -5
```

Expected: FAIL — `team-sessions.js` not found.

- [ ] **Step 3: Create `src/lib/team-sessions.ts`**

```typescript
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { encodeProjectPath } from './path-encoder.js';
import { identifyProject } from './project-identifier.js';
import { encrypt, decrypt, type DerivedKey } from './crypto.js';
import { TEAM_DIR } from './team-repo.js';
import { remapJsonlBuffer, extractCwdFromJsonl } from './jsonl-remapper.js';

export function localSessionsDir(cwd: string): string {
  return join(homedir(), '.claude', 'projects', encodeProjectPath(cwd));
}

export function teamSessionsDir(base: string, email: string, projectId: string): string {
  return join(base, 'sessions', email, projectId);
}

export async function readSessionFiles(dir: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (entry.endsWith('.jsonl')) {
        result.set(entry, await readFile(join(dir, entry)));
      }
    }
  } catch { /* dir doesn't exist — return empty */ }
  return result;
}

export async function copySessionsToTeamDir(
  srcDir: string,
  destDir: string,
  derived?: DerivedKey,
): Promise<number> {
  const sessions = await readSessionFiles(srcDir);
  if (sessions.size === 0) return 0;
  await mkdir(destDir, { recursive: true });
  for (const [filename, content] of sessions) {
    if (derived) {
      await writeFile(join(destDir, `${filename}.enc`), encrypt(content, derived));
    } else {
      await writeFile(join(destDir, filename), content);
    }
  }
  return sessions.size;
}

export async function copySessionsFromRepo(
  sessionsRoot: string,
  projectId: string,
  destDir: string,
  localCwd: string,
  derived?: DerivedKey,
): Promise<number> {
  let devFolders: string[];
  try {
    devFolders = await readdir(sessionsRoot);
  } catch {
    return 0;
  }
  await mkdir(destDir, { recursive: true });
  let count = 0;
  for (const email of devFolders) {
    const projDir = join(sessionsRoot, email, projectId);
    let files: string[];
    try {
      files = await readdir(projDir);
    } catch {
      continue;
    }
    for (const file of files) {
      const isEnc = file.endsWith('.jsonl.enc');
      const isPlain = file.endsWith('.jsonl') && !isEnc;
      if (!isEnc && !isPlain) continue;

      let data = await readFile(join(projDir, file));
      if (isEnc && derived) {
        data = decrypt(data, derived);
      }

      const remoteCwd = extractCwdFromJsonl(data);
      if (remoteCwd && remoteCwd !== localCwd) {
        data = remapJsonlBuffer(data, remoteCwd, localCwd);
      }

      const destFilename = isEnc ? file.slice(0, -'.enc'.length) : file;
      const destPath = join(destDir, destFilename);

      let finalPath = destPath;
      try {
        await readFile(destPath);
        // File already exists — suffix with first 3 chars of dev name
        const initials = email.split('@')[0].slice(0, 3);
        const base = destFilename.slice(0, -'.jsonl'.length);
        finalPath = join(destDir, `${base}.${initials}.jsonl`);
      } catch { /* doesn't exist, use destPath */ }

      await writeFile(finalPath, data);
      count++;
    }
  }
  return count;
}

export async function pushSessions(
  email: string,
  cwd: string,
  derived?: DerivedKey,
): Promise<number> {
  const projectInfo = identifyProject(cwd);
  if (!projectInfo) return 0;
  const srcDir = localSessionsDir(cwd);
  const destDir = teamSessionsDir(TEAM_DIR, email, projectInfo.projectId);
  return copySessionsToTeamDir(srcDir, destDir, derived);
}

export async function pullSessions(
  cwd: string,
  derived?: DerivedKey,
): Promise<number> {
  const projectInfo = identifyProject(cwd);
  if (!projectInfo) return 0;
  const sessionsRoot = join(TEAM_DIR, 'sessions');
  const destDir = localSessionsDir(cwd);
  return copySessionsFromRepo(sessionsRoot, projectInfo.projectId, destDir, cwd, derived);
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run tests/lib/team-sessions.test.ts 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 5: Build**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/lib/team-sessions.ts tests/lib/team-sessions.test.ts
git commit -m "feat: add team-sessions module for push/pull of Claude sessions"
```

---

## Task 3: Update `src/commands/team/init.ts` — consent prompts

**Files:**
- Modify: `src/commands/team/init.ts`

- [ ] **Step 1: Replace the file**

```typescript
import { input, confirm, select, password } from '@inquirer/prompts';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../../lib/config.js';
import { cloneTeamRepo, commitAndPush, TEAM_DIR } from '../../lib/team-repo.js';
import { readSkillsFromDir, readFileFromPath, LOCAL_SKILLS_DIR, LOCAL_CLAUDE_MD } from '../../lib/claude-skills.js';
import { getInstalledPluginIds } from '../../lib/claude-plugins.js';
import { writeProjectConfig } from '../../lib/project-config.js';
import { deriveKey } from '../../lib/crypto.js';
import { pushSessions } from '../../lib/team-sessions.js';

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

  // Session sharing consent
  console.log('\n⚠  Compartir sesiones de chat');
  console.log('   Tus sesiones de Claude Code para este proyecto se subirían');
  console.log('   al repo de equipo y serían visibles por todos los miembros.');
  console.log('   Las sesiones pueden contener código privado o información sensible.');

  const shareSession = await confirm({
    message: '¿Compartir sesiones con el equipo?',
    default: false,
  });

  let encryptSessions = false;
  if (shareSession) {
    const encChoice = await select({
      message: '¿Encriptar las sesiones?',
      choices: [
        { name: 'Sí — encriptadas con passphrase del equipo (recomendado)', value: true },
        { name: 'No — JSONL plano (legible directo en GitHub)', value: false },
      ],
    });
    encryptSessions = encChoice;

    let derived: ReturnType<typeof deriveKey> | undefined;
    if (encryptSessions) {
      const teamPassphrase = await password({
        message: 'Team passphrase (shared with all devs, min 12 chars):',
        mask: '*',
        validate: (v) => v.length >= 12 || 'Minimum 12 characters',
      });
      derived = deriveKey(teamPassphrase, repoUrl);
    }

    const count = await pushSessions(config.email, process.cwd(), derived);
    if (count > 0) {
      commitAndPush(repoUrl, token, `feat: share ${count} team sessions`);
      console.log(`  Uploaded ${count} sessions`);
    }
  }

  await writeProjectConfig({ repo: repoUrl, shareSession, encryptSessions });

  console.log('\n✓ Team repo initialized and pushed.');
  console.log(`  Devs can now run: cortex install --repo ${repoUrl}`);
}
```

- [ ] **Step 2: Build**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/commands/team/init.ts
git commit -m "feat: add session sharing consent prompts to cortex team init"
```

---

## Task 4: Update `src/commands/team/push.ts` — push sessions

**Files:**
- Modify: `src/commands/team/push.ts`

- [ ] **Step 1: Replace the file**

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { password } from '@inquirer/prompts';
import { loadConfig } from '../../lib/config.js';
import { pullTeamRepo, commitAndPush, TEAM_DIR, hasLocalClone } from '../../lib/team-repo.js';
import { readSkillsFromDir, readFileFromPath, LOCAL_SKILLS_DIR, LOCAL_CLAUDE_MD } from '../../lib/claude-skills.js';
import { getInstalledPluginIds } from '../../lib/claude-plugins.js';
import { readProjectConfig } from '../../lib/project-config.js';
import { deriveKey } from '../../lib/crypto.js';
import { pushSessions } from '../../lib/team-sessions.js';

export async function teamPushCommand(): Promise<void> {
  const config = await loadConfig();
  const { repo: repoUrl, shareSession, encryptSessions } = await readProjectConfig();
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

  if (shareSession) {
    let derived: ReturnType<typeof deriveKey> | undefined;
    if (encryptSessions) {
      const teamPassphrase = await password({
        message: 'Team passphrase:',
        mask: '*',
        validate: (v) => v.length >= 12 || 'Minimum 12 characters',
      });
      derived = deriveKey(teamPassphrase, repoUrl);
    }
    const count = await pushSessions(config.email, process.cwd(), derived);
    if (count > 0) console.log(`  Uploaded ${count} sessions`);
  }

  commitAndPush(repoUrl, token, 'chore: update team Claude Code context');
  console.log('\n✓ Pushed to team repo.');
}
```

- [ ] **Step 2: Build**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/commands/team/push.ts
git commit -m "feat: team push uploads sessions when shareSession is true"
```

---

## Task 5: Update `src/commands/team/pull.ts` — pull sessions

**Files:**
- Modify: `src/commands/team/pull.ts`

- [ ] **Step 1: Replace the file**

```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { password } from '@inquirer/prompts';
import { loadConfig } from '../../lib/config.js';
import { pullTeamRepo, TEAM_DIR, hasLocalClone } from '../../lib/team-repo.js';
import {
  readSkillsFromDir, writeSkillToDir, readFileFromPath, writeFileToPath,
  LOCAL_SKILLS_DIR, LOCAL_CLAUDE_MD,
} from '../../lib/claude-skills.js';
import { installPlugin } from '../../lib/claude-plugins.js';
import { hasConflict, promptConflict, mergeContent } from '../../lib/conflict.js';
import { readProjectConfig } from '../../lib/project-config.js';
import { deriveKey } from '../../lib/crypto.js';
import { pullSessions } from '../../lib/team-sessions.js';

export async function teamPullCommand(): Promise<void> {
  await loadConfig();
  const { repo: repoUrl, encryptSessions } = await readProjectConfig();
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

  let cortexManifest: { plugins?: string[] } = {};
  try {
    cortexManifest = JSON.parse(await readFile(join(TEAM_DIR, 'cortex.json'), 'utf-8'));
  } catch { /* no cortex.json is fine */ }

  for (const pluginId of cortexManifest.plugins ?? []) {
    try {
      installPlugin(pluginId);
    } catch (e) {
      console.warn(`  ⚠ Could not install ${pluginId}: ${(e as Error).message}`);
    }
  }

  // Pull team sessions (silent if none in repo)
  let derived: ReturnType<typeof deriveKey> | undefined;
  if (encryptSessions) {
    const teamPassphrase = await password({
      message: 'Team passphrase (to decrypt sessions):',
      mask: '*',
      validate: (v) => v.length >= 12 || 'Minimum 12 characters',
    });
    derived = deriveKey(teamPassphrase, repoUrl);
  }
  const sessionCount = await pullSessions(process.cwd(), derived);
  if (sessionCount > 0) {
    console.log(`  + ${sessionCount} sessions installed (restart Claude Code to see them)`);
  }

  console.log('\n✓ Team context applied.');
}
```

- [ ] **Step 2: Build**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add src/commands/team/pull.ts
git commit -m "feat: team pull installs team sessions with path remapping"
```

---

## Task 6: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add team sessions section to README**

Open `README.md`. Find the existing `## Commands` table and the team section. After the existing commands table, add a new `## Team context` section. The full README currently ends around line 203. Add the following content after the existing `## Commands` table but before `## Claude Code MCP integration`.

The new section to insert after the Commands table (after `| \`cortex setup-mcp\` | ... |` row):

```markdown

---

## Team context

Share skills, CLAUDE.md, plugins, and chat sessions with your team via a shared GitHub repo.

```bash
# Tech Lead — one-time setup
cortex team init --repo https://github.com/your-org/claude-config

# Push your local .claude/ context + sessions (if opted in)
cortex team push

# Dev — pull team context + sessions
cortex team pull

# New dev — first-time install
cortex install --repo https://github.com/your-org/claude-config
```

### What gets shared

| What | Source | Destination |
|---|---|---|
| Skills | `.claude/skills/*.md` | `skills/` in team repo |
| CLAUDE.md | `.claude/CLAUDE.md` | `CLAUDE.md` in team repo |
| Plugins | Installed Claude plugins | `cortex.json → plugins[]` |
| Sessions (opt-in) | `~/.claude/projects/<project>/` | `sessions/<email>/<project-id>/` |

### Session sharing

During `cortex team init` you are asked once whether to share your Claude Code chat sessions with the team. If you accept:

- Sessions are uploaded on every `cortex team push`
- Teammates get your sessions (paths remapped to their machine) on `cortex team pull`
- Claude Code shows all team sessions natively — no extra steps

You can choose to encrypt sessions with a shared team passphrase (AES-256-GCM). Share the passphrase with your team via a password manager — it is never stored by cortex.

**Two machines, same GitHub user:** Each machine generates unique session IDs, so pushing from both machines never creates duplicates.

> **Privacy:** Sessions may contain source code, API calls, and sensitive context. Only opt in if your team has a shared understanding that sessions are visible to all members.
```

- [ ] **Step 2: Commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add README.md
git commit -m "docs: document cortex team sessions in README"
```

---

## Task 7: Full test suite + bump to 0.4.2

- [ ] **Step 1: Run full test suite**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npx vitest run 2>&1 | tail -8
```

Expected: all tests pass (104 previous + new team-sessions tests + 1 new project-config test).

- [ ] **Step 2: Smoke test team commands**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && node dist/cli.js team --help
```

Expected output includes `init`, `push`, `pull` subcommands.

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && node dist/cli.js team pull --help
```

Expected: shows `Usage: cortex team pull`.

- [ ] **Step 3: Bump to 0.4.2**

In `package.json`, change `"version": "0.4.1"` to `"version": "0.4.2"`.

```bash
cd /home/sebastiadev/Escritorio/cortex-cli && npm run build 2>&1 | tail -3 && node dist/cli.js --version
```

Expected: `0.4.2`

- [ ] **Step 4: Final commit**

```bash
cd /home/sebastiadev/Escritorio/cortex-cli
git add package.json
git commit -m "chore: bump to 0.4.2 — team session sharing"
```

---

## Self-Review

**Spec coverage:**
- ✅ Consent prompt shown once during `cortex team init` → stored in `cortex.json`
- ✅ `shareSession: false` leaves all behavior unchanged (checked in push/pull)
- ✅ Encryption prompt + passphrase → `deriveKey(passphrase, repoUrl)` consistent across push/pull
- ✅ `team/push.ts` calls `pushSessions` only when `shareSession: true`
- ✅ `team/pull.ts` calls `pullSessions` always (silent if no sessions in repo)
- ✅ Path remapping via `remapJsonlBuffer` in `copySessionsFromRepo`
- ✅ Collision handling: suffixes with dev initials
- ✅ Same user + 2 machines: different UUIDs = no collision (UUID generated by Claude Code)
- ✅ README updated with team sessions section
- ✅ Version bumped to 0.4.2

**Type consistency:**
- `pushSessions(email, cwd, derived?)` — used in init.ts and push.ts consistently
- `pullSessions(cwd, derived?)` — used in pull.ts consistently
- `deriveKey(teamPassphrase, repoUrl)` — same salt (repoUrl) used in init, push, pull

**No placeholders:** All code blocks are complete and runnable.
