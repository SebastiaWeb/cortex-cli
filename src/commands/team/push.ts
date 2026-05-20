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
