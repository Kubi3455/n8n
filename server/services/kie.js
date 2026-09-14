import { config, useMock } from '../config.js';
import { pollUntil, requestJson, sleep } from './http.js';

const SAMPLE_VIDEO = 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4';

/**
 * Step 4 - "Generate Video with VEO3" + "Wait for VEO3 Rendering" + "Download Video from VEO3".
 * kie.ai returns a taskId immediately; the rendered clip shows up on record-info later.
 */
export const generateVideo = async ({ prompt, model, aspectRatio, imageUrl, onProgress }) => {
  if (useMock('kie')) {
    onProgress?.('Mock VEO3: render simüle ediliyor');
    await sleep(1500);
    return { url: SAMPLE_VIDEO, taskId: `mock-${Date.now()}`, mocked: true };
  }

  const headers = {
    Authorization: `Bearer ${config.kie.apiKey}`,
    'Content-Type': 'application/json',
  };

  const submitted = await requestJson(config.kie.generateUrl, {
    method: 'POST',
    headers,
    // VEO3 expects the structured prompt as a single JSON-encoded string, the same shape
    // the workflow's "Format Prompt" code node produced.
    body: JSON.stringify({
      prompt,
      model: model || 'veo3_fast',
      aspectRatio: aspectRatio || '16:9',
      imageUrls: imageUrl ? [imageUrl] : [],
    }),
  });

  const taskId = submitted?.data?.taskId;
  if (!taskId) throw new Error(`VEO3 did not return a taskId: ${JSON.stringify(submitted).slice(0, 300)}`);
  onProgress?.(`VEO3 görevi kabul edildi (${taskId})`);

  const record = await pollUntil(
    async () => {
      const status = await requestJson(`${config.kie.recordUrl}?taskId=${encodeURIComponent(taskId)}`, { headers });
      const data = status?.data || {};
      const flag = Number(data.successFlag ?? 0);
      if (flag === 1) return { done: true, value: data };
      if (flag > 1) return { failed: true, error: data.errorMessage || `VEO3 failed with flag ${flag}` };
      return { done: false, status: 'rendering' };
    },
    {
      initialDelayMs: config.polling.initialDelayMs,
      intervalMs: config.polling.intervalMs,
      timeoutMs: config.polling.videoTimeoutMs,
      onTick: (attempt) => onProgress?.(`VEO3 hâlâ render ediyor (kontrol #${attempt})`),
    },
  );

  const url = record?.response?.resultUrls?.[0];
  if (!url) throw new Error('VEO3 finished without a result URL');
  return { url, taskId, raw: record };
};
