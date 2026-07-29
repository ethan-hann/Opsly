/**
 * Migration: retire the 'data_export' org feature.
 *
 * Data export is no longer gateable — users can always extract their own data,
 * regardless of plan or instance configuration. 'data_export' has been removed
 * from ORG_FEATURES, so any surviving org_features row for it is dead weight
 * that could only cause confusion (or resurrect a gate if the filtering in
 * getOrgFeatureStates were ever relaxed).
 *
 * Safe to run more than once.
 */

import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rowCount } = await client.query(`
      DELETE FROM org_features
      WHERE feature = 'data_export'
    `);

    await client.query('COMMIT');
    console.log(
      `Migration complete: removed ${rowCount ?? 0} 'data_export' org_features row(s).`,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
