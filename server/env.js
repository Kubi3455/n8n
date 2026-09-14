import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal .env reader. Keeping it in-house means the app has no dependencies at all,
 * so it starts with a plain `node server/index.js` - no install step.
 */
export const loadEnv = (root) => {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;

  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const index = line.indexOf('=');
    if (index === -1) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Real environment variables win over the file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
};
