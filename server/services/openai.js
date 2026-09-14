import fs from 'node:fs/promises';
import path from 'node:path';
import { config, useMock } from '../config.js';
import {
  IMAGE_PROMPT_SYSTEM,
  MASTER_PROMPT_SCHEMA,
  VISION_PROMPT,
  captionUser,
  imagePromptUser,
  videoScriptSystem,
  videoScriptUser,
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

/** Step 2 - "OpenAI Vision: Analyze Reference Image" (YAML description of the reference image). */
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

/** Step 2 - "Generate Image Prompt" agent (structured output: { image_prompt }). */
export const generateImagePrompt = async ({ caption, imageDescription }) => {
  if (useMock('openai')) {
    await sleep(500);
    return {
      image_prompt:
        'a person casually holding the product near a kitchen counter; action: turning the package to read the label; '
        + 'mood: relaxed weekday morning; setting: small apartment kitchen with a mug and crumbs on the counter; '
        + 'style/camera: phone snapshot, handheld framing, off-center composition, natural window light, mild grain; '
        + 'colors: charcoal and warm yellow; text accuracy: keep every word on the package exactly as visible',
    };
  }

  const raw = await chat({
    model: config.openai.agentModel,
    jsonMode: true,
    messages: [
      { role: 'system', content: IMAGE_PROMPT_SYSTEM },
      { role: 'user', content: imagePromptUser({ caption, imageDescription }) },
    ],
  });

  const parsed = parseJsonOutput(raw);
  if (!parsed.image_prompt) throw new Error('Image prompt agent returned no "image_prompt" key');
  return parsed;
};

/** Step 3 - "AI Agent: Generate Video Script" (structured output: { title, final_prompt }). */
export const generateVideoScript = async ({ caption, imageDescription, model }) => {
  if (useMock('openai')) {
    await sleep(700);
    return {
      title: 'Morning Counter Unboxing In One Take',
      final_prompt: JSON.stringify({
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
        VFX: { transformation: 'none', impact: 'none', particles: 'none', environment: 'none' },
        audio: { music: 'ambient tone', sfx: ['paper rustle'], ambience: 'kitchen room tone', voiceover: { delivery: 'casual', line: '' } },
        ending: 'the package rests on the counter, label facing camera',
        text: 'none',
        format: '16:9',
        keywords: ['demo brand', 'ugc', 'unboxing', 'handheld', 'ambient', 'everyday'],
      }),
    };
  }

  const raw = await chat({
    model: config.openai.agentModel,
    jsonMode: true,
    messages: [
      { role: 'system', content: videoScriptSystem(MASTER_PROMPT_SCHEMA) },
      { role: 'user', content: videoScriptUser({ caption, imageDescription, model }) },
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

/** Step 5 - "Rewrite Caption with GPT-4o" (hard limit: under 200 characters). */
export const rewriteCaption = async ({ idea, title }) => {
  if (useMock('openai')) {
    await sleep(400);
    return `${title} - shot it in one take on the kitchen counter. no studio, no script, just the product doing its thing.`;
  }

  const raw = await chat({
    model: config.openai.captionModel,
    messages: [{ role: 'user', content: captionUser({ idea, title }) }],
  });

  const caption = raw.replace(/^["']|["']$/g, '').trim();
  // The prompt insists on <200 characters; enforce it here so downstream posts never fail on length.
  return caption.length > 200 ? `${caption.slice(0, 197).trimEnd()}...` : caption;
};
