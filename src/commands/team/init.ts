import { input, confirm, select, password } from '@inquirer/prompts';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../../lib/config.js';
import { cloneTeamRepo, commitAndPush, TEAM_DIR } from '../../lib/team-repo.js';
import { readSkillsFromDir, readFileFromPath, LOCAL_SKILLS_DIR, LOCAL_CLAUDE_MD } from '../../lib/claude-skills.js';
import { getInstalledPluginIds } from '../../lib/claude-plugins.js';
import { writeProjectConfig } from '../../lib/project-config.js';
import { identifyProject } from '../../lib/project-identifier.js';
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

    // Ensure project has a stable ID even without git — use repoUrl so all devs share it
    if (!identifyProject(process.cwd())) {
      await writeProjectConfig({ projectId: repoUrl });
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
