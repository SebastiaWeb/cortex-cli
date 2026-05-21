#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const { join } = require('path');

try {
  const prefix = execSync('npm config get prefix', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  const binDir = join(prefix, 'bin');
  const pathDirs = (process.env.PATH || '').split(':');
  const inPath = pathDirs.some((d) => d === binDir);

  if (!inPath) {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  cortex installed — but needs a PATH fix       ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log(`\n  Binary location: ${join(binDir, 'cortex')}`);
    console.log(`  Missing from PATH: ${binDir}\n`);
    console.log('  Fix (add ONE of these to ~/.zshrc or ~/.bashrc):\n');
    console.log(`    export PATH="${binDir}:$PATH"\n`);
    console.log('  Then reload your shell:');
    console.log('    source ~/.zshrc   (zsh)');
    console.log('    source ~/.bashrc  (bash)\n');
  } else {
    console.log(`\n  ✓ cortex installed. Run: cortex --version\n`);
  }
} catch {
  // silently ignore — postinstall must never break the install
}
