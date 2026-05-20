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

  const skills = await readSkillsFromDir(join(TEAM_DIR, 'skills'));
  for (const [filename, content] of skills) {
    await writeSkillToDir(LOCAL_SKILLS_DIR, filename, content);
    console.log(`  + ${filename}`);
  }

  const claudeMd = await readFileFromPath(join(TEAM_DIR, 'CLAUDE.md'));
  if (claudeMd) {
    await writeFileToPath(LOCAL_CLAUDE_MD, claudeMd);
    console.log('  + CLAUDE.md');
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

  const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
  raw.teamRepo = repoUrl;
  await writeFile(CONFIG_PATH, JSON.stringify(raw, null, 2), 'utf-8');

  console.log('\n✓ Team context installed. Restart Claude Code to activate new skills and plugins.');
}
