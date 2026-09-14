import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Read .env before anything below looks at process.env.
loadEnv(root);

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

export const auth = {
  // Sessions are signed cookies backed by a server-side token store.
  sessionTtlMs: Number(process.env.SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000),
  cookieName: 'vvs_session',
};

export const paths = {
  root,
  public: path.join(root, 'public'),
  uploads: path.join(root, 'uploads'),
  data: path.join(root, 'data'),
};

export const config = {
  // 3000 çok yaygın; başka bir uygulamayla çakışmaması için varsayılanı ayrı tutuyoruz.
  port: Number(process.env.PORT || 4321),
  // Public base URL, used to build image URLs that third party APIs must be able to fetch.
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 4321}`).replace(/\/$/, ''),

  // When no provider key is configured the pipeline runs against built-in fakes,
  // so the whole flow is demoable end to end without spending credits.
  mockMode: bool(process.env.MOCK_MODE, false),

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    visionModel: process.env.OPENAI_VISION_MODEL || 'chatgpt-4o-latest',
    agentModel: process.env.OPENAI_AGENT_MODEL || 'gpt-4.1-mini',
    captionModel: process.env.OPENAI_CAPTION_MODEL || 'gpt-4o',
  },

  fal: {
    apiKey: process.env.FAL_API_KEY || '',
    // Reference-image edit (NanoBanana) and plain text-to-image share the same account/key.
    editUrl: process.env.FAL_EDIT_URL || 'https://queue.fal.run/fal-ai/nano-banana/edit',
    generateUrl: process.env.FAL_GENERATE_URL || 'https://queue.fal.run/fal-ai/nano-banana',
  },

  kie: {
    apiKey: process.env.KIE_API_KEY || '',
    generateUrl: process.env.KIE_GENERATE_URL || 'https://api.kie.ai/api/v1/veo/generate',
    recordUrl: process.env.KIE_RECORD_URL || 'https://api.kie.ai/api/v1/veo/record-info',
  },

  polling: {
    // "Wait for Image Edit" / "Wait for VEO3 Rendering" were fixed 20s waits in n8n.
    // Here we poll, which is the same idea but resilient to slower renders.
    initialDelayMs: Number(process.env.POLL_INITIAL_DELAY_MS || 20000),
    intervalMs: Number(process.env.POLL_INTERVAL_MS || 10000),
    imageTimeoutMs: Number(process.env.IMAGE_TIMEOUT_MS || 5 * 60 * 1000),
    videoTimeoutMs: Number(process.env.VIDEO_TIMEOUT_MS || 15 * 60 * 1000),
  },
};

/** The launcher may land on a different port, so the public URL is settled at listen time. */
export const setPublicUrl = (url) => {
  config.publicUrl = url.replace(/\/$/, '');
};

export const providerStatus = () => ({
  mockMode: config.mockMode,
  openai: Boolean(config.openai.apiKey),
  fal: Boolean(config.fal.apiKey),
  kie: Boolean(config.kie.apiKey),
});

// A provider falls back to its mock implementation when MOCK_MODE is on or its key is missing.
export const useMock = (provider) => config.mockMode || !config[provider].apiKey;
