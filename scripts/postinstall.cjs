#!/usr/bin/env node
'use strict';

/**
 * Ensures the `cortex` binary is accessible in PATH after `npm install -g`.
 *
 * Strategy (in order):
 *  1. Windows  — Node.js installer always puts npm global bin in PATH. Done.
 *  2. Already in PATH — nothing to do.
 *  3. Symlink into a directory already in PATH (~/.local/bin on Linux, /usr/local/bin on macOS).
 *  4. Fallback: append export PATH / nvm init to every existing shell config found.
 */

const { execSync } = require('child_process');
const { join } = require('path');
const {
  appendFileSync, readFileSync, existsSync,
  symlinkSync, mkdirSync, unlinkSync,
} = require('fs');
const { homedir, platform } = require('os');

// ── 1. Windows ────────────────────────────────────────────────────────────────
if (platform() === 'win32') {
  // The official Node.js installer and nvm-windows both add the global bin to
  // the system PATH automatically. Nothing to do.
  console.log('\n  ✓ cortex installed. Run: cortex --version');
  console.log('  To update later: npm install -g cortex-sync@latest\n');
  process.exit(0);
}

try {
  // ── Resolve the actual binary path ──────────────────────────────────────────
  const prefix = execSync('npm config get prefix', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'ignore'],
  }).trim();

  const binDir  = join(prefix, 'bin');
  const cortexBin = join(binDir, 'cortex');
  const pathDirs = (process.env.PATH || '').split(':');

  // ── 2. Already in PATH ──────────────────────────────────────────────────────
  if (pathDirs.some((d) => d === binDir)) {
    console.log('\n  ✓ cortex installed. Run: cortex --version\n');
    process.exit(0);
  }

  // ── 3. Symlink into a directory that is already in PATH ─────────────────────
  // Ordered by likelihood: ~/.local/bin (Linux), /usr/local/bin (macOS/Linux)
  const home = homedir();
  const symlinkCandidates = [
    join(home, '.local', 'bin'),
    '/usr/local/bin',
  ];

  for (const dir of symlinkCandidates) {
    if (!pathDirs.some((d) => d === dir)) continue;
    try {
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, 'cortex');
      if (existsSync(dest)) unlinkSync(dest);
      symlinkSync(cortexBin, dest);
      console.log('\n  ✓ cortex installed. Run: cortex --version');
      console.log('  To update later: npm install -g cortex-sync@latest\n');
      process.exit(0);
    } catch { /* no write permission — try next candidate */ }
  }

  // ── 4. Fallback: patch every shell config found ──────────────────────────────
  // Covers zsh, bash (interactive + login), and POSIX profile.
  const rcFiles = [
    join(home, '.zshrc'),
    join(home, '.bashrc'),
    join(home, '.bash_profile'),
    join(home, '.profile'),
  ].filter(existsSync);

  // Detect nvm users: if nvm.sh exists but isn't sourced in any config,
  // add the nvm init block (more robust than a hard-coded version path).
  const nvmDir = process.env.NVM_DIR || join(home, '.nvm');
  const nvmSh  = join(nvmDir, 'nvm.sh');
  const isNvmUser = existsSync(nvmSh);

  let patched = false;
  for (const rc of rcFiles) {
    const content = readFileSync(rc, 'utf-8');

    if (isNvmUser && !content.includes('nvm.sh')) {
      appendFileSync(rc,
        `\n# nvm (added by cortex-sync)\n` +
        `export NVM_DIR="${nvmDir}"\n` +
        `[ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"\n`,
      );
      patched = true;
    } else if (!content.includes(binDir)) {
      appendFileSync(rc, `\nexport PATH="${binDir}:$PATH" # added by cortex-sync\n`);
      patched = true;
    }
  }

  if (patched) {
    console.log('\n  ✓ cortex installed.');
    console.log('  Open a new terminal (or run: source ~/.zshrc) to use it.');
    console.log('  To update later: npm install -g cortex-sync@latest\n');
  } else {
    console.log(`\n  ✓ cortex installed to: ${cortexBin}`);
    console.log(`  If "cortex" is not found, add to your shell config:`);
    console.log(`    export PATH="${binDir}:$PATH"`);
    console.log('  To update later: npm install -g cortex-sync@latest\n');
  }
} catch {
  // Never break the install process
}
