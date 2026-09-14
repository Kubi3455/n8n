import { config, useMock } from '../config.js';
import { pollUntil, requestJson, sleep } from './http.js';

const PLACEHOLDER_COLORS = ['#f0b429', '#3ecf8e', '#5b8def', '#f16360', '#a78bfa', '#38bdf8'];

/** A same-origin, canvas-safe placeholder used only in mock mode when no reference image exists. */
const placeholderImage = (label) => {
  const color = PLACEHOLDER_COLORS[Math.abs(hash(label)) % PLACEHOLDER_COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
    <rect width="100%" height="100%" fill="${color}"/>
    <text x="50%" y="50%" font-family="system-ui, sans-serif" font-size="56" font-weight="700"
      fill="#14161c" text-anchor="middle" dominant-baseline="middle">${escapeXml(label)}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};

const hash = (text) => {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
};

const escapeXml = (text) => text.replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char]));

const submitAndPoll = async ({ submitUrl, body, label, onProgress }) => {
  const headers = { Authorization: `Key ${config.fal.apiKey}`, 'Content-Type': 'application/json' };

  const submitted = await requestJson(submitUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  const statusUrl = submitted.status_url;
  const responseUrl = submitted.response_url;
  if (!statusUrl || !responseUrl) throw new Error('NanoBanana did not return queue URLs');
  onProgress?.(`${label} kuyruğa alındı (${submitted.request_id})`);

  await pollUntil(
    async () => {
      const status = await requestJson(statusUrl, { headers });
      if (status.status === 'COMPLETED') return { done: true, value: status };
      if (status.status === 'FAILED' || status.error) {
        return { failed: true, error: status.error || 'NanoBanana reported FAILED' };
      }
      return { done: false, status: status.status };
    },
    {
      initialDelayMs: config.polling.initialDelayMs,
      intervalMs: config.polling.intervalMs,
      timeoutMs: config.polling.imageTimeoutMs,
      onTick: (attempt, result) => onProgress?.(`${label} hâlâ çalışıyor: ${result.status || 'running'} (kontrol #${attempt})`),
    },
  );

  const result = await requestJson(responseUrl, { headers });
  const url = result?.images?.[0]?.url;
  if (!url) throw new Error('NanoBanana returned no image');
  return { url, raw: result };
};

/**
 * "NanoBanana: Create Image" + "Wait for Image Edit" + "Download Edited Image" - edits a
 * reference image. Used by both video modes and by the carousel when a reference was uploaded.
 */
export const editImage = async ({ prompt, imageUrl, displayUrl, onProgress }) => {
  if (useMock('fal')) {
    onProgress?.('Mock NanoBanana: görsel düzenleme simüle ediliyor');
    await sleep(1200);
    return { url: displayUrl || imageUrl, mocked: true };
  }

  return submitAndPoll({
    submitUrl: config.fal.editUrl,
    body: { prompt, image_urls: [imageUrl] },
    label: 'NanoBanana',
    onProgress,
  });
};

/**
 * Text-to-image, no reference needed. Used by the carousel when the member didn't upload
 * a brand/product image, and by the video modes if that ever becomes an option too.
 */
export const generateImage = async ({ prompt, label = 'Görsel', onProgress }) => {
  if (useMock('fal')) {
    onProgress?.(`Mock NanoBanana: ${label.toLowerCase()} simüle ediliyor`);
    await sleep(1000);
    return { url: placeholderImage(label), mocked: true };
  }

  return submitAndPoll({
    submitUrl: config.fal.generateUrl,
    body: { prompt },
    label: 'NanoBanana',
    onProgress,
  });
};
