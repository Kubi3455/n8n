import { log, setResult, setStatus, setStep, setVariantResult, setVariantStatus, setVariantStep } from './jobs.js';
import * as fal from './services/fal.js';
import * as kie from './services/kie.js';
import { hostFile } from './services/media.js';
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
    const editedImageUrl = await hostFile({ url: edited.url, prefix: `${userId}-${imageKey}-image` });
    setResult(job, { editedImageUrl });
    setStep(job, 'image', 'done', edited.mocked ? 'Mock düzenleme (referans görsel kullanıldı)' : 'Görsel hazır');

    // Hook/Varyant Testi: everything above this line runs once and is shared; each variant
    // below only differs in its hook angle, so only script/video/caption fork per variant.
    await Promise.all(job.variants.map(async (variant) => {
      const label = variant.angleLabel || variant.id;
      try {
        setVariantStatus(job, variant.id, 'running');

        setVariantStep(job, variant.id, 'script', 'running', 'Yapılandırılmış video prompt\'u yazılıyor');
        const script = await openai.generateVideoScript({ caption: idea, imageDescription, model, style, angle: variant.angle });
        // "Format Prompt" node: the structured prompt travels to VEO3 as an escaped JSON string.
        const formattedPrompt = JSON.stringify(script.final_prompt);
        setVariantResult(job, variant.id, { title: script.title, finalPrompt: script.final_prompt });
        log(job, `[${label}] Senaryo başlığı: ${script.title}`);
        setVariantStep(job, variant.id, 'script', 'done', script.title);

        setVariantStep(job, variant.id, 'video', 'running', `${model} ile render ediliyor (${aspectRatio})`);
        const video = await kie.generateVideo({
          prompt: formattedPrompt,
          model,
          aspectRatio,
          imageUrl: editedImageUrl,
          onProgress: (message) => log(job, `[${label}] ${message}`),
        });
        setVariantResult(job, variant.id, { videoUrl: video.url });
        setVariantStep(job, variant.id, 'video', 'done', video.mocked ? 'Mock render (örnek klip)' : 'Video hazır');

        setVariantStep(job, variant.id, 'caption', 'running');
        const caption = await openai.writeSocialCaption({ idea, title: script.title, contentType: job.contentType, angle: variant.angle });
        setVariantResult(job, variant.id, { caption });
        log(job, `[${label}] Paylaşım metni hazır (${caption.length} karakter)`);
        setVariantStep(job, variant.id, 'caption', 'done');

        setVariantStatus(job, variant.id, 'done');
      } catch (error) {
        const failingStep = variant.steps.find((step) => step.status === 'running');
        if (failingStep) setVariantStep(job, variant.id, failingStep.id, 'failed', error.message);
        setVariantStatus(job, variant.id, 'failed', error.message);
        log(job, `[${label}] ${error.message}`, 'error');
      }
    }));

    // The project record keeps every variant plus - for backward-compatible thumbnails/table
    // rows that expect one title/caption/video - the first one that actually succeeded.
    const succeeded = job.variants.filter((variant) => variant.status === 'done');
    const primary = succeeded[0]?.result || {};
    await upsertProject(userId, imageKey, {
      variants: job.variants.map((variant) => ({
        id: variant.id, angle: variant.angle, angleLabel: variant.angleLabel, status: variant.status, ...variant.result,
      })),
      title: primary.title || '',
      caption: primary.caption || '',
      videoUrl: primary.videoUrl || '',
      finalPrompt: primary.finalPrompt || '',
      status: succeeded.length > 0 ? PROJECT_STATUS.ready : PROJECT_STATUS.error,
    });

    if (succeeded.length === 0) {
      setStatus(job, 'failed', 'Tüm varyantlar başarısız oldu');
      log(job, 'Tüm varyantlar başarısız oldu', 'error');
    } else {
      setStatus(job, 'completed');
      log(job, job.variants.length > 1 ? `Akış tamamlandı (${succeeded.length}/${job.variants.length} varyant başarılı)` : 'Akış tamamlandı');
    }
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

        const imageUrl = await hostFile({ url: generated.url, prefix: `${userId}-${imageKey}-slide-${index}` });
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

/**
 * Topic and/or reference image in, a downloadable 3D character (.glb) out - for people who
 * design characters and want a rotatable model, not a flat image or a video.
 */
const runCharacterPipeline = async (job, { filePath, publicUrl }) => {
  const userId = job.userId;
  const imageKey = job.imageKey;
  const idea = job.input.idea;

  setStatus(job, 'running');

  try {
    setStep(job, 'collect', 'running');
    await upsertProject(userId, imageKey, {
      contentType: 'character3d',
      imageUrl: publicUrl || '',
      idea,
      status: PROJECT_STATUS.processing,
    });
    setResult(job, { imageUrl: publicUrl || '' });
    log(job, 'Konu ve görsel kaydedildi');
    setStep(job, 'collect', 'done', 'Kaydedildi');

    let imageDescription = '';
    if (filePath) {
      setStep(job, 'prompt', 'running', 'Referans görsel analiz ediliyor');
      imageDescription = await openai.analyzeImage({ filePath, imageUrl: publicUrl });
      await upsertProject(userId, imageKey, { imageDescription });
      setResult(job, { imageDescription });
      log(job, 'Referans görsel analiz edildi');
    }

    setStep(job, 'prompt', 'running', '3D karakter prompt\'u hazırlanıyor');
    const { title, prompt } = await openai.generateCharacterPrompt({ idea, imageDescription });
    await upsertProject(userId, imageKey, { title, imagePrompt: prompt });
    setResult(job, { title, imagePrompt: prompt });
    log(job, `Karakter: ${title}`);
    setStep(job, 'prompt', 'done', title);

    // A reference image goes straight to image-to-3D (no NanoBanana re-edit first - we want
    // the original character art, not a re-styled version of it) unmodified; without one,
    // Tripo3D's text-to-3D endpoint generates directly from the prompt.
    setStep(job, 'model', 'running', 'Tripo3D ile model üretiliyor');
    const remoteImageUrl = await resolveRemoteImageUrl({ publicUrl, filePath });
    const model = await fal.generate3DModel({
      imageUrl: remoteImageUrl,
      prompt,
      onProgress: (message) => log(job, message),
    });
    const modelUrl = await hostFile({ url: model.modelUrl, prefix: `${userId}-${imageKey}-model` });
    const previewImageUrl = await hostFile({ url: model.previewUrl, prefix: `${userId}-${imageKey}-preview` });
    await upsertProject(userId, imageKey, { modelUrl, previewImageUrl, status: PROJECT_STATUS.ready });
    setResult(job, { modelUrl, previewImageUrl });
    setStep(job, 'model', 'done', model.mocked ? 'Mock önizleme (gerçek .glb için API anahtarı gerekir)' : 'Model hazır');

    setStep(job, 'caption', 'running');
    const caption = await openai.writeSocialCaption({ idea, title, contentType: 'character3d' });
    await upsertProject(userId, imageKey, { caption });
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

/** Single entry point: dispatches on job.contentType so index.js doesn't need to know the details. */
export const runPipeline = async (job, upload) => {
  if (job.contentType === 'carousel') return runCarouselPipeline(job, upload);
  if (job.contentType === 'character3d') return runCharacterPipeline(job, upload);
  return runVideoPipeline(job, upload, job.contentType === 'video' ? 'general' : 'ugc');
};
