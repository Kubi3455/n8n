import { log, setResult, setStatus, setStep } from './jobs.js';
import * as fal from './services/fal.js';
import * as kie from './services/kie.js';
import { hostImage } from './services/media.js';
import * as openai from './services/openai.js';
import { PROJECT_STATUS, getSettings, upsertProject } from './store.js';

const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(url);

/**
 * Third party renderers must be able to download the reference image. When the app is only
 * reachable on localhost we inline the bytes instead, so the flow works without a public URL.
 */
const resolveRemoteImageUrl = async ({ publicUrl, filePath }) => {
  if (!filePath) return null;
  if (!isLocal(publicUrl)) return publicUrl;
  return openai.toDataUri(filePath);
};

/**
 * "Normal Video" and "UGC Reklam Videosu" share every step; only the prompt style differs.
 * style: 'ugc' | 'general'
 */
const runVideoPipeline = async (job, { filePath, publicUrl }, style) => {
  const userId = job.userId;
  const settings = await getSettings(userId);
  const imageKey = job.imageKey;
  const idea = job.input.idea;
  const model = job.input.model || settings.model;
  const aspectRatio = job.input.aspectRatio || settings.aspectRatio;

  setStatus(job, 'running');

  try {
    setStep(job, 'collect', 'running');
    await upsertProject(userId, imageKey, {
      contentType: job.contentType,
      imageUrl: publicUrl,
      idea,
      status: PROJECT_STATUS.processing,
    });
    setResult(job, { imageUrl: publicUrl });
    log(job, 'Fikir ve referans görsel kaydedildi');
    setStep(job, 'collect', 'done', 'Görsel kaydedildi');

    setStep(job, 'image', 'running', 'Referans görsel analiz ediliyor');
    const imageDescription = await openai.analyzeImage({ filePath, imageUrl: publicUrl });
    await upsertProject(userId, imageKey, { imageDescription });
    setResult(job, { imageDescription });
    log(job, 'Referans görsel analiz edildi');

    setStep(job, 'image', 'running', 'Görsel prompt\'u hazırlanıyor');
    const { image_prompt: imagePrompt } = await openai.generateImagePrompt({ caption: idea, imageDescription, style });
    await upsertProject(userId, imageKey, { imagePrompt });
    setResult(job, { imagePrompt });
    log(job, 'Görsel prompt\'u hazır');

    setStep(job, 'image', 'running', 'Görsel üretiliyor');
    const remoteImageUrl = await resolveRemoteImageUrl({ publicUrl, filePath });
    const edited = await fal.editImage({
      prompt: imagePrompt,
      imageUrl: remoteImageUrl,
      displayUrl: publicUrl,
      onProgress: (message) => log(job, message),
    });
    const editedImageUrl = await hostImage({ url: edited.url, prefix: `${userId}-${imageKey}-image` });
    setResult(job, { editedImageUrl });
    setStep(job, 'image', 'done', edited.mocked ? 'Mock düzenleme (referans görsel kullanıldı)' : 'Görsel hazır');

    setStep(job, 'script', 'running', 'Yapılandırılmış video prompt\'u yazılıyor');
    const script = await openai.generateVideoScript({ caption: idea, imageDescription, model, style });
    // "Format Prompt" node: the structured prompt travels to VEO3 as an escaped JSON string.
    const formattedPrompt = JSON.stringify(script.final_prompt);
    await upsertProject(userId, imageKey, { title: script.title, finalPrompt: script.final_prompt });
    setResult(job, { title: script.title, finalPrompt: script.final_prompt });
    log(job, `Senaryo başlığı: ${script.title}`);
    setStep(job, 'script', 'done', script.title);

    setStep(job, 'video', 'running', `${model} ile render ediliyor (${aspectRatio})`);
    const video = await kie.generateVideo({
      prompt: formattedPrompt,
      model,
      aspectRatio,
      imageUrl: editedImageUrl,
      onProgress: (message) => log(job, message),
    });
    await upsertProject(userId, imageKey, { videoUrl: video.url, status: PROJECT_STATUS.ready });
    setResult(job, { videoUrl: video.url });
    setStep(job, 'video', 'done', video.mocked ? 'Mock render (örnek klip)' : 'Video hazır');

    setStep(job, 'caption', 'running');
    const caption = await openai.writeSocialCaption({ idea, title: script.title, contentType: job.contentType });
    await upsertProject(userId, imageKey, { caption, status: PROJECT_STATUS.ready });
    setResult(job, { caption });
    log(job, `Paylaşım metni hazır (${caption.length} karakter)`);
    setStep(job, 'caption', 'done');

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

/** Topic in, 6-slide swipeable Instagram carousel out - image, headline and body per slide. */
const runCarouselPipeline = async (job, { filePath, publicUrl }) => {
  const userId = job.userId;
  const imageKey = job.imageKey;
  const idea = job.input.idea;

  setStatus(job, 'running');

  try {
    setStep(job, 'collect', 'running');
    await upsertProject(userId, imageKey, {
      contentType: 'carousel',
      imageUrl: publicUrl || '',
      idea,
      status: PROJECT_STATUS.processing,
    });
    setResult(job, { imageUrl: publicUrl || '' });
    log(job, 'Konu kaydedildi');
    setStep(job, 'collect', 'done', 'Kaydedildi');

    setStep(job, 'plan', 'running', 'Referans görsel analiz ediliyor');
    const imageDescription = filePath ? await openai.analyzeImage({ filePath, imageUrl: publicUrl }) : '';
    if (imageDescription) await upsertProject(userId, imageKey, { imageDescription });

    setStep(job, 'plan', 'running', 'Carousel planı yazılıyor');
    const { slides: plan } = await openai.generateCarouselPlan({ idea, imageDescription });
    log(job, `${plan.length} slaytlık plan hazır`);
    setStep(job, 'plan', 'done', `${plan.length} slayt planlandı`);

    setStep(job, 'slides', 'running', `0/${plan.length} görsel hazır`);
    const remoteImageUrl = await resolveRemoteImageUrl({ publicUrl, filePath });
    let done = 0;

    const slides = await Promise.all(
      plan.map(async (slide, i) => {
        const index = i + 1;
        const label = `Slayt ${index}`;
        const generated = remoteImageUrl
          ? await fal.editImage({
              prompt: slide.image_prompt,
              imageUrl: remoteImageUrl,
              displayUrl: publicUrl,
              onProgress: (message) => log(job, `${label}: ${message}`),
            })
          : await fal.generateImage({
              prompt: slide.image_prompt,
              label,
              onProgress: (message) => log(job, `${label}: ${message}`),
            });

        const imageUrl = await hostImage({ url: generated.url, prefix: `${userId}-${imageKey}-slide-${index}` });
        done += 1;
        setStep(job, 'slides', 'running', `${done}/${plan.length} görsel hazır`);

        return { index, imageUrl, headline: slide.headline, body: slide.body };
      }),
    );

    slides.sort((a, b) => a.index - b.index);
    await upsertProject(userId, imageKey, { slides, status: PROJECT_STATUS.ready });
    setResult(job, { slides });
    setStep(job, 'slides', 'done', `${slides.length} görsel hazır`);

    setStep(job, 'caption', 'running');
    const title = plan[0]?.headline || 'Carousel';
    const caption = await openai.writeSocialCaption({ idea, title, contentType: 'carousel' });
    await upsertProject(userId, imageKey, { title, caption, status: PROJECT_STATUS.ready });
    setResult(job, { title, caption });
    log(job, `Paylaşım metni hazır (${caption.length} karakter)`);
    setStep(job, 'caption', 'done');

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

/** Single entry point: dispatches on job.contentType so index.js doesn't need to know the details. */
export const runPipeline = async (job, upload) => {
  if (job.contentType === 'carousel') return runCarouselPipeline(job, upload);
  return runVideoPipeline(job, upload, job.contentType === 'video' ? 'general' : 'ugc');
};
