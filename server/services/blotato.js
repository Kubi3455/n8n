import { config, useMock } from '../config.js';
import { requestJson, sleep } from './http.js';

const headers = () => ({
  'blotato-api-key': config.blotato.apiKey,
  'Content-Type': 'application/json',
});

/** Step 5 - "Upload Video to BLOTATO": re-hosts the rendered clip on Blotato's CDN. */
export const uploadMedia = async (mediaUrl) => {
  if (useMock('blotato')) {
    await sleep(500);
    return { url: mediaUrl, mocked: true };
  }

  const data = await requestJson(`${config.blotato.baseUrl}/media`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ url: mediaUrl }),
  });

  const url = data?.url || data?.data?.url;
  if (!url) throw new Error('Blotato media upload returned no URL');
  return { url, raw: data };
};

/** Per-platform target payload, mirroring what each Blotato node sent in the workflow. */
const buildTarget = (platform, { title }) => {
  switch (platform.id) {
    case 'youtube':
      return {
        targetType: 'youtube',
        title,
        privacyStatus: platform.privacyStatus || 'private',
        shouldNotifySubscribers: Boolean(platform.notifySubscribers),
      };
    case 'facebook':
      return { targetType: 'facebook', pageId: platform.pageId };
    case 'pinterest':
      return { targetType: 'pinterest', boardId: platform.boardId };
    default:
      return { targetType: platform.id };
  }
};

const validate = (platform) => {
  if (!platform.accountId) return `${platform.label}: hesap kimliği tanımlı değil`;
  if (platform.id === 'facebook' && !platform.pageId) return `${platform.label}: sayfa kimliği tanımlı değil`;
  if (platform.id === 'pinterest' && !platform.boardId) return `${platform.label}: pano kimliği tanımlı değil`;
  return null;
};

/** Step 5 - one call per enabled platform, fanned out in parallel like the n8n branches. */
export const publish = async ({ platform, text, title, mediaUrl }) => {
  const problem = validate(platform);

  // Without a Blotato key the whole fan-out is simulated, so a missing account id is
  // only worth a note here - it becomes a real blocker once the key is configured.
  if (useMock('blotato')) {
    await sleep(300 + Math.random() * 600);
    return {
      platform: platform.id,
      label: platform.label,
      status: 'published',
      detail: problem ? `Mock paylaşım - ${problem}` : 'Mock paylaşım (Blotato anahtarı yok)',
      postId: `mock-${platform.id}-${Date.now()}`,
    };
  }

  if (problem) return { platform: platform.id, label: platform.label, status: 'skipped', detail: problem };

  try {
    const data = await requestJson(`${config.blotato.baseUrl}/posts`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        post: {
          accountId: platform.accountId,
          target: buildTarget(platform, { title }),
          content: { text, platform: platform.id, mediaUrls: [mediaUrl] },
        },
      }),
    });
    return {
      platform: platform.id,
      label: platform.label,
      status: 'published',
      postId: data?.id || data?.data?.id || null,
      detail: 'Blotato üzerinden paylaşıldı',
    };
  } catch (error) {
    return { platform: platform.id, label: platform.label, status: 'failed', detail: error.message };
  }
};
