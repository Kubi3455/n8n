import { config, useMock } from '../config.js';
import { pollUntil, requestJson, sleep } from './http.js';

/**
 * Step 2 - "NanoBanana: Create Image" + "Wait for Image Edit" + "Download Edited Image".
 * fal.ai runs the edit on a queue: submit, poll the status URL, then read the response.
 */
export const editImage = async ({ prompt, imageUrl, displayUrl, onProgress }) => {
  if (useMock('fal')) {
    onProgress?.('Mock NanoBanana: görsel düzenleme simüle ediliyor');
    await sleep(1200);
    return { url: displayUrl || imageUrl, mocked: true };
  }

  const headers = {
    Authorization: `Key ${config.fal.apiKey}`,
    'Content-Type': 'application/json',
  };

  const submitted = await requestJson(config.fal.submitUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt, image_urls: [imageUrl] }),
  });

  const statusUrl = submitted.status_url;
  const responseUrl = submitted.response_url;
  if (!statusUrl || !responseUrl) throw new Error('NanoBanana did not return queue URLs');
  onProgress?.(`NanoBanana kuyruğa alındı (${submitted.request_id})`);

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
      onTick: (attempt, result) => onProgress?.(`NanoBanana hâlâ çalışıyor: ${result.status || 'running'} (kontrol #${attempt})`),
    },
  );

  const result = await requestJson(responseUrl, { headers });
  const url = result?.images?.[0]?.url;
  if (!url) throw new Error('NanoBanana returned no edited image');
  return { url, raw: result };
};
