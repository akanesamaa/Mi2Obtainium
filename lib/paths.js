import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
export const DATA_DIR = process.env.MI_DATA_DIR || path.join(ROOT, 'data');
export const PUBLIC_DIR = path.join(ROOT, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });
