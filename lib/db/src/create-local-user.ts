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
  const rawArgs = process.argv.slice(2);
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

  const email = args[0]?.toLowerCase();
  const password = args[1];
  const firstName = args[2] ?? null;
  const lastName = args[3] ?? null;

  if (!email || !password) {
    console.error(
      'Usage: pnpm --filter @workspace/db create-local-user <email> <password> [firstName] [lastName]',
    );
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Check whether the user already exists before creating.
    const existing = await pool.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE email = $1`,
      [email],
    );

    if (existing.rows.length > 0) {
      const user = existing.rows[0]!;
      console.log(`Local user already exists: ${user.email} (id: ${user.id}), skipping.`);
      return;
    }

    const passwordHash = hashPassword(password);

    const { rows } = await pool.query<{ id: string; email: string }>(
      `
      INSERT INTO users (email, first_name, last_name, auth_provider, password_hash)
      VALUES ($1, $2, $3, 'local', $4)
      RETURNING id, email
      `,
      [email, firstName, lastName, passwordHash],
    );

    const user = rows[0];
    if (!user) {
      throw new Error('Failed to create local user');
    }

    console.log(`Local user created: ${user.email} (id: ${user.id})`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
