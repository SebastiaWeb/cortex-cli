#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const { join } = require('path');
const { appendFileSync, readFileSync, existsSync, symlinkSync, mkdirSync, unlinkSync } = require('fs');
const { homedir } = require('os');

try {
  const prefix = execSync('npm config get prefix', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'ignore'],
  }).trim();

  const binDir = join(prefix, 'bin');
  const cortexBin = join(binDir, 'cortex');
  const pathDirs = (process.env.PATH || '').split(':');
  const inPath = pathDirs.some((d) => d === binDir);

  if (inPath) {
    console.log('\n  ✓ cortex installed. Run: cortex --version\n');
    return;
  }

  // Try to symlink into ~/.local/bin (already in PATH on most Linux/Mac setups)
  const localBin = join(homedir(), '.local', 'bin');
  const localCortex = join(localBin, 'cortex');
  const localBinInPath = pathDirs.some((d) => d === localBin);

  if (localBinInPath && existsSync(cortexBin)) {
    try {
      mkdirSync(localBin, { recursive: true });
      if (existsSync(localCortex)) unlinkSync(localCortex);
      symlinkSync(cortexBin, localCortex);
      console.log('\n  ✓ cortex installed and linked. Run: cortex --version\n');
      return;
    } catch { /* fall through to shell config fix */ }
  }

  // Fallback: add to shell config
  const shell = process.env.SHELL || '';
  const home = homedir();
  let rcFile = null;
  if (shell.includes('zsh')) rcFile = join(home, '.zshrc');
  else if (shell.includes('bash')) rcFile = join(home, '.bashrc');
  else if (shell.includes('fish')) rcFile = join(home, '.config', 'fish', 'config.fish');

  if (!rcFile) {
    console.log(`\n  cortex installed to: ${cortexBin}`);
    console.log(`  Add to your shell config: export PATH="${binDir}:$PATH"\n`);
    return;
  }

  const existing = existsSync(rcFile) ? readFileSync(rcFile, 'utf-8') : '';
  const nvmDir = process.env.NVM_DIR || join(home, '.nvm');
  const nvmSh = join(nvmDir, 'nvm.sh');
  const isNvmUser = existsSync(nvmSh);

  let lineToAdd;
  if (isNvmUser && !existing.includes('nvm.sh')) {
    lineToAdd =
      `\n# nvm (added by cortex-sync)\n` +
      `export NVM_DIR="${nvmDir}"\n` +
      `[ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"\n`;
  } else if (!existing.includes(binDir)) {
    lineToAdd = `\nexport PATH="${binDir}:$PATH" # added by cortex-sync\n`;
  } else {
    console.log(`\n  cortex installed. Open a new terminal to use it.\n`);
    return;
  }

  appendFileSync(rcFile, lineToAdd);
  console.log(`\n  ✓ cortex installed. Open a new terminal to use it.\n`);
} catch {
  // never break the install
}
