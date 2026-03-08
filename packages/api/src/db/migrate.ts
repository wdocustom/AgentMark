import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  logger.info('Running database migrations...');

  try {
    // Create migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Check if initial schema has been applied
    const { rows } = await pool.query(
      "SELECT name FROM _migrations WHERE name = 'initial_schema'"
    );

    if (rows.length === 0) {
      const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
      await pool.query(schema);
      await pool.query(
        "INSERT INTO _migrations (name) VALUES ('initial_schema')"
      );
      logger.info('Initial schema applied successfully');
    } else {
      logger.info('Schema already up to date');
    }
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    throw error;
  } finally {
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));
