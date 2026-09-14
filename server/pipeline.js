import { log, setResult, setStatus, setStep } from './jobs.js';
import * as blotato from './services/blotato.js';
import * as fal from './services/fal.js';
import * as kie from './services/kie.js';
import * as openai from './services/openai.js';
import { PROJECT_STATUS, getSettings, upsertProject } from './store.js';

const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(url);

/**
 * Third party renderers must be able to download the reference image. When the app is only
 * reachable on localhost we inline the bytes instead, which keeps the flow working without
 * the public Google Drive folder the original workflow required.
 */
const resolveRemoteImageUrl = async ({ publicUrl, filePath }) => {
  if (!isLocal(publicUrl)) return publicUrl;
  return openai.toDataUri(filePath);
};

/**
 * Runs the whole workflow for one idea. Each block below maps 1:1 to a sticky-note
 * section of the n8n canvas.
 */
export const runPipeline = async (job, { filePath, publicUrl }) => {
  const userId = job.userId;
  const settings = await getSettings(userId);
  const imageKey = job.imageKey;
  const idea = job.input.idea;
  const model = job.input.model || settings.model;
  const aspectRatio = job.input.aspectRatio || settings.aspectRatio;

  setStatus(job, 'running');

  try {
    // ---- STEP 1 - Collect idea & image -------------------------------------------------
    setStep(job, 'collect', 'running');
    await upsertProject(userId, imageKey, {
      imageUrl: publicUrl,
      idea,
      status: PROJECT_STATUS.processing,
    });
    setResult(job, { imageUrl: publicUrl });
    log(job, 'Fikir ve referans görsel kaydedildi');
    setStep(job, 'collect', 'done', 'Görsel kaydedildi');

    // ---- STEP 2 - Create image with NanoBanana -----------------------------------------
    setStep(job, 'image', 'running', 'Referans görsel analiz ediliyor');
    const imageDescription = await openai.analyzeImage({ filePath, imageUrl: publicUrl });
    await upsertProject(userId, imageKey, { imageDescription });
    setResult(job, { imageDescription });
    log(job, 'Referans görsel analiz edildi');

    setStep(job, 'image', 'running', 'UGC görsel prompt\'u hazırlanıyor');
    const { image_prompt: imagePrompt } = await openai.generateImagePrompt({ caption: idea, imageDescription });
    await upsertProject(userId, imageKey, { imagePrompt });
    setResult(job, { imagePrompt });
    log(job, 'Görsel prompt\'u hazır');

    setStep(job, 'image', 'running', 'NanoBanana görseli düzenliyor');
    const remoteImageUrl = await resolveRemoteImageUrl({ publicUrl, filePath });
    const edited = await fal.editImage({
      prompt: imagePrompt,
      imageUrl: remoteImageUrl,
      displayUrl: publicUrl,
      onProgress: (message) => log(job, message),
    });
    setResult(job, { editedImageUrl: edited.url });
    setStep(job, 'image', 'done', edited.mocked ? 'Mock düzenleme (referans görsel kullanıldı)' : 'Düzenlenmiş görsel hazır');

    // ---- STEP 3 - Generate video ad script ---------------------------------------------
    setStep(job, 'script', 'running', 'Yapılandırılmış video prompt\'u yazılıyor');
    const script = await openai.generateVideoScript({ caption: idea, imageDescription, model });
    // "Format Prompt" node: the structured prompt travels to VEO3 as an escaped JSON string.
    const formattedPrompt = JSON.stringify(script.final_prompt);
    await upsertProject(userId, imageKey, { title: script.title, finalPrompt: script.final_prompt });
    setResult(job, { title: script.title, finalPrompt: script.final_prompt });
    log(job, `Senaryo başlığı: ${script.title}`);
    setStep(job, 'script', 'done', script.title);

    // ---- STEP 4 - Generate video with VEO3 ---------------------------------------------
    setStep(job, 'video', 'running', `${model} ile render ediliyor (${aspectRatio})`);
    const video = await kie.generateVideo({
      prompt: formattedPrompt,
      model,
      aspectRatio,
      imageUrl: edited.url,
      onProgress: (message) => log(job, message),
    });
    await upsertProject(userId, imageKey, { videoUrl: video.url, status: PROJECT_STATUS.ready });
    setResult(job, { videoUrl: video.url });
    setStep(job, 'video', 'done', video.mocked ? 'Mock render (örnek klip)' : 'Video hazır');

    // ---- STEP 5 - Auto-post to all platforms -------------------------------------------
    setStep(job, 'publish', 'running', 'Caption yeniden yazılıyor');
    const caption = await openai.rewriteCaption({ idea, title: script.title });
    await upsertProject(userId, imageKey, { caption });
    setResult(job, { caption });
    log(job, `Caption hazır (${caption.length} karakter)`);

    setStep(job, 'publish', 'running', 'Video Blotato\'ya yükleniyor');
    const media = await blotato.uploadMedia(video.url);
    log(job, 'Video Blotato\'ya yüklendi');

    const selected = new Set(job.input.platforms || []);
    const targets = settings.platforms.filter((platform) => platform.enabled && selected.has(platform.id));
    if (targets.length === 0) log(job, 'Platform seçilmedi - paylaşım adımı atlandı', 'warn');

    setStep(job, 'publish', 'running', `${targets.length} platforma gönderiliyor`);
    // The n8n canvas fanned out to nine parallel branches and merged them; same idea here.
    const posts = await Promise.all(
      targets.map((platform) =>
        blotato.publish({ platform, text: caption, title: script.title, mediaUrl: media.url }),
      ),
    );
    for (const post of posts) {
      log(job, `${post.label}: ${post.status}${post.detail ? ` - ${post.detail}` : ''}`,
        post.status === 'failed' ? 'error' : post.status === 'skipped' ? 'warn' : 'info');
    }
    setResult(job, { posts });

    const published = posts.filter((post) => post.status === 'published').length;
    await upsertProject(userId, imageKey, {
      status: published > 0 ? PROJECT_STATUS.published : PROJECT_STATUS.ready,
    });
    setStep(job, 'publish', 'done', `${published}/${targets.length} platformda yayınlandı`);

    setStatus(job, 'completed');
    log(job, 'Akış tamamlandı');
  } catch (error) {
    const failing = job.steps.find((step) => step.status === 'running');
    if (failing) setStep(job, failing.id, 'failed', error.message);
    await upsertProject(userId, imageKey, { status: PROJECT_STATUS.error }).catch(() => {});
    setStatus(job, 'failed', error.message);
    log(job, error.message, 'error');
  }
};

