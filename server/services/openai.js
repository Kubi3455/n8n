import fs from 'node:fs/promises';
import path from 'node:path';
import { config, useMock } from '../config.js';
import {
  CAROUSEL_PLAN_SYSTEM,
  CHARACTER_PROMPT_SYSTEM,
  GENERAL_IMAGE_PROMPT_SYSTEM,
  MASTER_PROMPT_SCHEMA,
  UGC_IMAGE_PROMPT_SYSTEM,
  VISION_PROMPT,
  carouselPlanUser,
  characterPromptUser,
  generalImagePromptUser,
  generalVideoScriptUser,
  socialCaptionUser,
  ugcImagePromptUser,
  ugcVideoScriptUser,
  videoScriptSystem,
} from '../prompts.js';
import { requestJson, sleep } from './http.js';

const MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** Vision calls take the bytes inline, so a locally hosted upload works without a public URL. */
export const toDataUri = async (filePath) => {
  const buffer = await fs.readFile(filePath);
  const mime = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'image/jpeg';
  return `data:${mime};base64,${buffer.toString('base64')}`;
};

const chat = async ({ model, messages, jsonMode = false, temperature }) => {
  const body = { model, messages };
  if (jsonMode) body.response_format = { type: 'json_object' };
  if (temperature !== undefined) body.temperature = temperature;

  const data = await requestJson(`${config.openai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return data.choices?.[0]?.message?.content?.trim() || '';
};

const parseJsonOutput = (raw) => {
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Model did not return JSON: ${raw.slice(0, 200)}`);
    return JSON.parse(match[0]);
  }
};

/** "OpenAI Vision: Analyze Reference Image" - shared by every content type. */
export const analyzeImage = async ({ filePath, imageUrl }) => {
  if (useMock('openai')) {
    await sleep(600);
    return [
      'brand_name: Demo Brand',
      'color_scheme:',
      '  - hex: "#1B1B1F"',
      '    name: charcoal',
      '  - hex: "#F4C542"',
      '    name: warm yellow',
      'font_style: bold sans-serif',
      'visual_description: A compact product package held at an angle, label fully readable, clean matte finish.',
    ].join('\n');
  }

  const image = filePath ? await toDataUri(filePath) : imageUrl;
  return chat({
    model: config.openai.visionModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image_url', image_url: { url: image } },
        ],
      },
    ],
  });
};

const MOCK_IMAGE_PROMPT = {
  ugc:
    'a person casually holding the product near a kitchen counter; action: turning the package to read the label; '
    + 'mood: relaxed weekday morning; setting: small apartment kitchen with a mug and crumbs on the counter; '
    + 'style/camera: phone snapshot, handheld framing, off-center composition, natural window light, mild grain; '
    + 'colors: charcoal and warm yellow; text accuracy: keep every word on the package exactly as visible',
  general:
    'the product centered on a dark reflective surface; action: a slow reveal, package slightly turned toward camera; '
    + 'mood: premium, confident; setting: minimal studio backdrop with a soft gradient; '
    + 'style/camera: studio softbox lighting, shallow depth of field, straight-on framing; '
    + 'colors: charcoal and warm yellow; text accuracy: keep every word on the package exactly as visible',
};

/** "Generate Image Prompt" agent - style depends on content type ('ugc' | 'general'). */
export const generateImagePrompt = async ({ caption, imageDescription, style = 'ugc' }) => {
  if (useMock('openai')) {
    await sleep(500);
    return { image_prompt: MOCK_IMAGE_PROMPT[style] || MOCK_IMAGE_PROMPT.general };
  }

  const isUgc = style === 'ugc';
  const raw = await chat({
    model: config.openai.agentModel,
    jsonMode: true,
    messages: [
      { role: 'system', content: isUgc ? UGC_IMAGE_PROMPT_SYSTEM : GENERAL_IMAGE_PROMPT_SYSTEM },
      { role: 'user', content: (isUgc ? ugcImagePromptUser : generalImagePromptUser)({ caption, imageDescription }) },
    ],
  });

  const parsed = parseJsonOutput(raw);
  if (!parsed.image_prompt) throw new Error('Image prompt agent returned no "image_prompt" key');
  return parsed;
};

const MOCK_VIDEO_SCRIPT = {
  ugc: {
    title: 'Morning Counter Unboxing In One Take',
    schema: {
      description: 'A quick handheld clip of someone opening the product on a kitchen counter.',
      style: 'photorealistic',
      camera: { type: 'fixed', movement: 'slight handheld drift', lens: '26mm phone lens' },
      lighting: { type: 'natural', sources: 'morning window light', FX: 'none' },
      environment: { location: 'small apartment kitchen', set_pieces: ['mug', 'crumbs', 'wooden counter'], mood: 'relaxed' },
      elements: ['product package with visible label'],
      subject: {
        character: { description: 'adult in a plain hoodie', pose: 'leaning over the counter', lip_sync_line: '' },
        product: { brand: 'Demo Brand', model: 'Starter Pack', action: 'package opened and tilted toward the camera' },
      },
      motion: { type: 'unboxing', details: 'hands lift the lid, turn the package, set it down' },
      ending: 'the package rests on the counter, label facing camera',
      text: 'none',
      format: '16:9',
      keywords: ['demo brand', 'ugc', 'unboxing', 'handheld', 'ambient', 'everyday'],
    },
  },
  general: {
    title: 'Studio Reveal With A Slow Push-In',
    schema: {
      description: 'A confident studio reveal of the product on a reflective surface.',
      style: 'cinematic',
      camera: { type: 'dolly', movement: 'slow push-in, then a gentle orbit', lens: '50mm, shallow depth of field' },
      lighting: { type: 'dramatic', sources: 'softbox key light with a rim light', FX: 'subtle reflections' },
      environment: { location: 'minimal studio backdrop', set_pieces: ['dark reflective plinth', 'soft gradient background'], mood: 'premium, confident' },
      elements: ['product with visible label, catching the rim light'],
      subject: {
        character: { description: '', pose: '', lip_sync_line: '' },
        product: { brand: 'Demo Brand', model: 'Signature Edition', action: 'slow 180-degree reveal on the plinth' },
      },
      motion: { type: 'reveal', details: 'camera pushes in as the product slowly rotates into full view' },
      ending: 'freeze frame on the product, logo catching a final glint of light',
      text: 'logo pulse at end only',
      format: '16:9',
      keywords: ['demo brand', 'studio', 'reveal', 'cinematic', 'premium', 'product'],
    },
  },
};

/** "AI Agent: Generate Video Script" - style depends on content type ('ugc' | 'general'). */
export const generateVideoScript = async ({ caption, imageDescription, model, style = 'ugc' }) => {
  if (useMock('openai')) {
    await sleep(700);
    const mock = MOCK_VIDEO_SCRIPT[style] || MOCK_VIDEO_SCRIPT.general;
    return { title: mock.title, final_prompt: JSON.stringify(mock.schema) };
  }

  const isUgc = style === 'ugc';
  const raw = await chat({
    model: config.openai.agentModel,
    jsonMode: true,
    messages: [
      { role: 'system', content: videoScriptSystem(MASTER_PROMPT_SCHEMA) },
      { role: 'user', content: (isUgc ? ugcVideoScriptUser : generalVideoScriptUser)({ caption, imageDescription, model }) },
    ],
  });

  const parsed = parseJsonOutput(raw);
  if (!parsed.title || !parsed.final_prompt) {
    throw new Error('Video script agent returned no "title"/"final_prompt" keys');
  }
  // The agent is asked for a stringified JSON; accept an object too and normalise it.
  if (typeof parsed.final_prompt !== 'string') parsed.final_prompt = JSON.stringify(parsed.final_prompt);
  return parsed;
};

const MOCK_CAROUSEL_SLIDES = [
  { headline: 'Sabahları Bu Hatayı Yapma', body: '', image_prompt: 'a clean minimal desk scene at sunrise, soft warm light, top-down flat lay, product centered' },
  { headline: '1. Adım: Hazırlık', body: 'İşe başlamadan önce ortamı sadeleştir.', image_prompt: 'a tidy minimal desk with a single notebook, soft warm light, top-down flat lay' },
  { headline: '2. Adım: Odaklan', body: 'Tek bir işe 25 dakika ver, dikkatini dağıtma.', image_prompt: 'a warm-lit desk scene with a timer object, soft shadows, top-down flat lay' },
  { headline: '3. Adım: Kısa Mola', body: 'Her 25 dakikada 5 dakika ayağa kalk.', image_prompt: 'a bright window scene suggesting a short break, soft warm light, minimal composition' },
  { headline: '4. Adım: Kaydet', body: 'Günün sonunda küçük bir not al.', image_prompt: 'a notebook with a pen on a warm-lit desk, top-down flat lay, minimal composition' },
  { headline: 'Bunu Kaydet, Sonra Uygula', body: '', image_prompt: 'a clean minimal desk scene at golden hour, soft warm light, top-down flat lay, calm mood' },
];

/** New: turns an idea into a 6-slide Instagram carousel plan. */
export const generateCarouselPlan = async ({ idea, imageDescription }) => {
  if (useMock('openai')) {
    await sleep(700);
    return { slides: MOCK_CAROUSEL_SLIDES };
  }

  const raw = await chat({
    model: config.openai.agentModel,
    jsonMode: true,
    messages: [
      { role: 'system', content: CAROUSEL_PLAN_SYSTEM },
      { role: 'user', content: carouselPlanUser({ idea, imageDescription }) },
    ],
  });

  const parsed = parseJsonOutput(raw);
  if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error('Carousel planner returned no "slides" array');
  }
  // Trust but verify: keep exactly 6, padding or trimming defensively rather than failing the run.
  const slides = parsed.slides.slice(0, 6);
  while (slides.length < 6) slides.push({ headline: '', body: '', image_prompt: idea || 'a clean minimal scene' });
  return { slides };
};

/** New: turns an idea (and optional reference image) into a 3D character generation prompt. */
export const generateCharacterPrompt = async ({ idea, imageDescription }) => {
  if (useMock('openai')) {
    await sleep(600);
    return {
      title: 'Zırhlı Gezgin Karakteri',
      prompt:
        'a stylized armored traveler character, weathered leather and metal plate details, warm bronze and teal color '
        + 'palette, relaxed A-pose facing forward, arms slightly away from body; single centered subject, plain neutral '
        + 'background, full body visible, no other objects',
    };
  }

  const raw = await chat({
    model: config.openai.agentModel,
    jsonMode: true,
    messages: [
      { role: 'system', content: CHARACTER_PROMPT_SYSTEM },
      { role: 'user', content: characterPromptUser({ idea, imageDescription }) },
    ],
  });

  const parsed = parseJsonOutput(raw);
  if (!parsed.title || !parsed.prompt) throw new Error('Character prompt agent returned no "title"/"prompt" keys');
  return parsed;
};

/** Final step for every content type: a ready-to-copy caption, always under 200 characters. */
export const writeSocialCaption = async ({ idea, title, contentType }) => {
  if (useMock('openai')) {
    await sleep(400);
    return contentType === 'carousel'
      ? `${title} — kaydır, ipuçlarını kaçırma. Faydalı bulduysan kaydet.`
      : `${title} — tek çekimde, olduğu gibi.`;
  }

  const raw = await chat({
    model: config.openai.captionModel,
    messages: [{ role: 'user', content: socialCaptionUser({ idea, title, contentType }) }],
  });

  const caption = raw.replace(/^["']|["']$/g, '').trim();
  // The prompt insists on <200 characters; enforce it here so the delivered text never breaks that promise.
  return caption.length > 200 ? `${caption.slice(0, 197).trimEnd()}...` : caption;
};
