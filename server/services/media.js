import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, paths } from '../config.js';

const EXTENSION_BY_CONTENT_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

/**
 * Downloads a provider-hosted image and re-serves it from our own /uploads/ - so the
 * browser can draw it onto a <canvas> (carousel text overlay) without hitting a cross-origin
 * taint, and so the link keeps working even if the provider later expires its own copy.
 *
 * Already-local URLs (our own /uploads/, or a data: URI) pass through untouched.
 */
export const hostImage = async ({ url, prefix }) => {
  if (!url) return url;
  if (url.startsWith(`${config.publicUrl}/`) || url.startsWith('data:')) return url;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Görsel indirilemedi (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = (response.headers.get('content-type') || 'image/png').split(';')[0].trim();
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType] || '.png';

  const fileName = `${prefix}-${crypto.randomBytes(6).toString('hex')}${extension}`;
  await fs.mkdir(paths.uploads, { recursive: true });
  await fs.writeFile(path.join(paths.uploads, fileName), buffer);
  return `${config.publicUrl}/uploads/${fileName}`;
};
