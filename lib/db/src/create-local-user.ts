/**
 * CLI script: create or update a local-auth user.
 *
 * Usage:
 *   DATABASE_URL=... pnpm --filter @workspace/db create-local-user <email> <password> [firstName] [lastName]
 */

import crypto from 'crypto';
import pg from 'pg';

const { Pool } = pg;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

async function main(): Promise<void> {
  const email = process.argv[2]?.toLowerCase();
  const password = process.argv[3];
  const firstName = process.argv[4] ?? null;
  const lastName = process.argv[5] ?? null;

  if (!email || !password) {
    console.error(
      'Usage: pnpm --filter @workspace/db create-local-user <email> <password> [firstName] [lastName]',
    );
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set');
  }

  const passwordHash = hashPassword(password);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const { rows } = await pool.query<{ id: string; email: string }>(
      `
      INSERT INTO users (email, first_name, last_name, auth_provider, password_hash)
      VALUES ($1, $2, $3, 'local', $4)
      ON CONFLICT (email)
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        auth_provider = 'local',
        password_hash = EXCLUDED.password_hash,
        external_auth_id = NULL,
        profile_image_url = NULL,
        updated_at = NOW()
      RETURNING id, email
      `,
      [email, firstName, lastName, passwordHash],
    );

    const user = rows[0];
    if (!user) {
      throw new Error('Failed to create/update local user');
    }

    console.log(`Local user ready: ${user.email} (id: ${user.id})`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
