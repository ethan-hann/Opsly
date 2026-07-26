// Cross-platform preinstall check (replaces the sh -c version that breaks on Windows).
// Removes stray lockfiles and enforces pnpm as the package manager.
// ESM because scripts/package.json sets "type": "module".
import { unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 24) {
  process.stderr.write(`Node 24 or newer is required. Detected ${process.versions.node}. Use \`nvm use\` or \`fnm use\` after installing Node 24 (see .nvmrc).\n`);
  process.exit(1);
}

for (const f of ['package-lock.json', 'yarn.lock']) {
  try { unlinkSync(f); } catch (_) {}
}

// Point git at our committed hooks so new worktrees/branches auto-install deps.
// Idempotent; shared across all worktrees via the common git config.
try {
  execSync('git config core.hooksPath .githooks', { stdio: 'ignore' });
} catch (_) {}

const agent = process.env.npm_config_user_agent || '';
if (!agent.startsWith('pnpm/')) {
  process.stderr.write('Use pnpm instead\n');
  process.exit(1);
}
