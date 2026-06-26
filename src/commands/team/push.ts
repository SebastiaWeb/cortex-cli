import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { confirm, password } from '@inquirer/prompts';
import { loadConfig } from '../../lib/config.js';
import { pullTeamRepo, commitAndPush, TEAM_DIR, hasLocalClone } from '../../lib/team-repo.js';
import {
  readSkillsFromDir, findClaudeMd, findExtraMdFiles, stripCortexPathBlock, LOCAL_SKILLS_DIR,
} from '../../lib/claude-skills.js';
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
  pullTeamRepo(repoUrl, token);

  const skills = await readSkillsFromDir(LOCAL_SKILLS_DIR);
  if (skills.size > 0) {
    await mkdir(join(TEAM_DIR, 'skills'), { recursive: true });
    for (const [filename, content] of skills) {
      await writeFile(join(TEAM_DIR, 'skills', filename), content, 'utf-8');
    }
  }

  const claudeMd = await findClaudeMd();
  if (claudeMd) {
    await writeFile(join(TEAM_DIR, 'CLAUDE.md'), stripCortexPathBlock(claudeMd.content), 'utf-8');
    console.log(`  CLAUDE.md (from ${claudeMd.foundAt})`);
  }

  // Offer to include other .md files found in the project
  const extras = await findExtraMdFiles();
  if (extras.length > 0) {
    console.log(`\nFound ${extras.length} additional .md file(s):`);
    for (const f of extras) console.log(`  ${f.relPath}`);
    const includeAll = await confirm({
      message: 'Include these files with team context?',
      default: true,
    });
    if (includeAll) {
      for (const { relPath, content } of extras) {
        const destPath = join(TEAM_DIR, 'docs', relPath);
        await mkdir(dirname(destPath), { recursive: true });
        await writeFile(destPath, content, 'utf-8');
      }
      console.log(`  Added ${extras.length} file(s) to docs/`);
    }
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
    const count = await pushSessions(config.email, process.cwd(), derived, repoUrl);
    if (count > 0) console.log(`  Uploaded ${count} sessions`);
  }

  commitAndPush(repoUrl, token, 'chore: update team Claude Code context');
  console.log('\n✓ Pushed to team repo.');
}
