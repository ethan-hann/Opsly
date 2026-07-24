// Cross-platform preinstall check (replaces the sh -c version that breaks on Windows).
// Removes stray lockfiles and enforces pnpm as the package manager.
// ESM because scripts/package.json sets "type": "module".
import { unlinkSync } from 'node:fs';

for (const f of ['package-lock.json', 'yarn.lock']) {
  try { unlinkSync(f); } catch (_) {}
}

const agent = process.env.npm_config_user_agent || '';
if (!agent.startsWith('pnpm/')) {
  process.stderr.write('Use pnpm instead\n');
  process.exit(1);
}
