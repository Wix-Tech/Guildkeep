/** paths.mjs — where the dev database lives (override with DB_PATH). */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DB_PATH ?? join(here, '..', 'data', 'app.db');
