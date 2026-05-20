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
