// Cross-platform preinstall check (replaces the sh -c version that breaks on Windows).
// Removes stray lockfiles and enforces pnpm as the package manager.
const { unlinkSync } = require('fs');

['package-lock.json', 'yarn.lock'].forEach(f => {
  try { unlinkSync(f); } catch (_) {}
});

const agent = process.env.npm_config_user_agent || '';
if (!agent.startsWith('pnpm/')) {
  process.stderr.write('Use pnpm instead\n');
  process.exit(1);
}
