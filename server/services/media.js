import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, paths } from '../config.js';

const EXTENSION_BY_CONTENT_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'model/gltf-binary': '.glb',
  'application/octet-stream': '.glb', // some providers mislabel .glb this way
};

/**
 * Downloads a provider-hosted file (image or 3D mesh) and re-serves it from our own
 * /uploads/ - so the browser can draw an image onto a <canvas> (carousel text overlay)
 * without hitting a cross-origin taint, a <model-viewer> can load a .glb without CORS
 * surprises, and the link keeps working even if the provider later expires its own copy.
 *
 * Already-local URLs (our own /uploads/, or a data: URI) pass through untouched.
 */
export const hostFile = async ({ url, prefix }) => {
  if (!url) return url;
  if (url.startsWith(`${config.publicUrl}/`) || url.startsWith('data:')) return url;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Dosya indirilemedi (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = (response.headers.get('content-type') || 'image/png').split(';')[0].trim();
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType] || (url.endsWith('.glb') ? '.glb' : '.png');

  const fileName = `${prefix}-${crypto.randomBytes(6).toString('hex')}${extension}`;
  await fs.mkdir(paths.uploads, { recursive: true });
  await fs.writeFile(path.join(paths.uploads, fileName), buffer);
  return `${config.publicUrl}/uploads/${fileName}`;
};

// Kept as an alias: most call sites are hosting images specifically, and the name reads better there.
export const hostImage = hostFile;
