/**
 * CLI script: grant or revoke instance-admin privileges for a user by email.
 *
 * Usage:
 *   DATABASE_URL=... pnpm --filter @workspace/db make-admin <email>
 *   DATABASE_URL=... pnpm --filter @workspace/db revoke-admin <email>
 */

import pg from 'pg';

const { Pool } = pg;

async function main(): Promise<void> {
  const revoke = process.argv.includes('--revoke');
  const email = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));

  if (!email) {
    console.error(`Usage: pnpm --filter @workspace/db ${revoke ? 'revoke' : 'make'}-admin <email>`);
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Look up the user first so we can skip gracefully if the role is already set.
    const existing = await pool.query<{ id: string; email: string; is_instance_admin: boolean }>(
      `SELECT id, email, is_instance_admin FROM users WHERE email = $1`,
      [email],
    );

    if (existing.rows.length === 0) {
      console.error(`No user found with email: ${email}`);
      process.exit(1);
    }

    const current = existing.rows[0]!;
    const desiredAdmin = !revoke;

    if (current.is_instance_admin === desiredAdmin) {
      const state = desiredAdmin ? 'already an instance admin' : 'already not an instance admin';
      console.log(`User ${current.email} (id: ${current.id}) is ${state}, skipping.`);
      return;
    }

    const { rows } = await pool.query<{ id: string; email: string; is_instance_admin: boolean }>(
      `UPDATE users
         SET is_instance_admin = $1, updated_at = NOW()
       WHERE email = $2
       RETURNING id, email, is_instance_admin`,
      [desiredAdmin, email],
    );

    const user = rows[0]!;
    const action = revoke ? 'Revoked instance-admin from' : 'Granted instance-admin to';
    console.log(`${action} ${user.email} (id: ${user.id}). is_instance_admin = ${user.is_instance_admin}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
