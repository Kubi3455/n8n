import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from './config.js';

const PROJECTS_FILE = path.join(paths.data, 'projects.json');
const SETTINGS_FILE = path.join(paths.data, 'settings.json');
const BRAND_KITS_FILE = path.join(paths.data, 'brandkits.json');

export const PROJECT_STATUS = {
  processing: 'processing',
  ready: 'ready',
  error: 'error',
};

export const CONTENT_TYPES = {
  video: 'video', // Normal Video - general purpose
  ugc: 'ugc', // UGC Reklam Videosu
  carousel: 'carousel', // Instagram Carousel
  character3d: 'character3d', // 3D Karakter
};

// Content types where an uploaded image is optional (a topic alone is enough).
export const OPTIONAL_IMAGE_TYPES = new Set(['carousel', 'character3d']);

export const DEFAULT_SETTINGS = {
  model: 'veo3_fast',
  aspectRatio: '16:9',
};

/**
 * Marka Kiti (Brand Kit): one persistent object per member - reference image(s), a color
 * palette, a tone/style instruction and a fixed character description. When a job opts in
 * (`useBrandKit`), this gets injected into that job's prompts (and, when no image was
 * uploaded for that job, into the NanoBanana reference image too) so recurring content
 * stays visually and tonally consistent without retyping the same brand details every time.
 */
export const DEFAULT_BRAND_KIT = {
  referenceImages: [], // [{ url, filePath }] - filePath lets local (no PUBLIC_URL) runs inline the bytes
  colorPalette: [], // ['#1B1B1F', 'warm yellow', ...] - free-form, passed straight into prompts
  toneInstruction: '',
  characterDescription: '',
  updatedAt: null,
};

let writeChain = Promise.resolve();

export const readJsonFile = async (file, fallback) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
};

/** Serialised writes: two concurrent jobs can never clobber each other's record. */
export const writeJsonFile = (file, data) => {
  writeChain = writeChain.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
  });
  return writeChain;
};

const allProjects = () => readJsonFile(PROJECTS_FILE, []);

export const listProjects = async (userId) => (await allProjects()).filter((project) => project.userId === userId);

export const getProject = async (userId, imageKey) =>
  (await allProjects()).find((project) => project.userId === userId && project.imageKey === imageKey) || null;

/**
 * Creates or updates one member's project. The content hash (of the upload, or of the
 * idea text when there is no upload) is the key, so re-submitting the same input refreshes
 * that project instead of duplicating it.
 */
export const upsertProject = async (userId, imageKey, values) => {
  const projects = await allProjects();
  const index = projects.findIndex((project) => project.userId === userId && project.imageKey === imageKey);
  const now = new Date().toISOString();

  if (index === -1) {
    const project = {
      id: `${userId}:${imageKey}`,
      userId,
      imageKey,
      contentType: CONTENT_TYPES.ugc,
      imageUrl: '',
      idea: '',
      imageDescription: '',
      imagePrompt: '',
      title: '',
      caption: '',
      finalPrompt: '',
      videoUrl: '',
      variants: [], // video/ugc only, when >1 hook variant was requested: [{ id, angle, angleLabel, status, title, caption, videoUrl, videoUrls: [{format, url}], finalPrompt }]
      slides: [], // carousel only: [{ index, imageUrl, headline, body }]
      modelUrl: '', // character3d only: downloadable .glb mesh
      previewImageUrl: '', // character3d only: rendered turntable preview
      feedback: null, // Basit Performans Geri Bildirimi: { rating: 1-5, note, updatedAt } once the member leaves one
      status: PROJECT_STATUS.processing,
      createdAt: now,
      updatedAt: now,
      ...values,
    };
    projects.unshift(project);
    await writeJsonFile(PROJECTS_FILE, projects);
    return project;
  }

  const project = { ...projects[index], ...values, updatedAt: now };
  projects[index] = project;
  await writeJsonFile(PROJECTS_FILE, projects);
  return project;
};

/**
 * Basit Performans Geri Bildirimi: attaches a 1-5 rating + free-text note to an existing
 * project. Never creates one - a project must already exist to leave feedback on it.
 */
export const saveProjectFeedback = async (userId, imageKey, { rating, note }) => {
  const projects = await allProjects();
  const index = projects.findIndex((project) => project.userId === userId && project.imageKey === imageKey);
  if (index === -1) return null;

  projects[index] = {
    ...projects[index],
    feedback: { rating, note, updatedAt: new Date().toISOString() },
  };
  await writeJsonFile(PROJECTS_FILE, projects);
  return projects[index];
};

export const deleteProject = async (userId, imageKey) => {
  const projects = await allProjects();
  const remaining = projects.filter((project) => !(project.userId === userId && project.imageKey === imageKey));
  await writeJsonFile(PROJECTS_FILE, remaining);
  return projects.length !== remaining.length;
};

export const deleteProjectsOfUser = async (userId) => {
  const projects = await allProjects();
  await writeJsonFile(PROJECTS_FILE, projects.filter((project) => project.userId !== userId));
};

const allSettings = () => readJsonFile(SETTINGS_FILE, {});

/** Every member keeps their own defaults (which VEO3 model, which aspect ratio). */
export const getSettings = async (userId) => ({ ...DEFAULT_SETTINGS, ...(await allSettings())[userId] });

export const saveSettings = async (userId, patch) => {
  const settings = await allSettings();
  const next = { ...(await getSettings(userId)), ...patch };
  settings[userId] = next;
  await writeJsonFile(SETTINGS_FILE, settings);
  return next;
};

const allBrandKits = () => readJsonFile(BRAND_KITS_FILE, {});

export const getBrandKit = async (userId) => ({ ...DEFAULT_BRAND_KIT, ...(await allBrandKits())[userId] });

export const saveBrandKit = async (userId, patch) => {
  const kits = await allBrandKits();
  const next = { ...(await getBrandKit(userId)), ...patch, updatedAt: new Date().toISOString() };
  kits[userId] = next;
  await writeJsonFile(BRAND_KITS_FILE, kits);
  return next;
};

export const deleteBrandKit = async (userId) => {
  const kits = await allBrandKits();
  delete kits[userId];
  await writeJsonFile(BRAND_KITS_FILE, kits);
  return structuredClone(DEFAULT_BRAND_KIT);
};

/** A brand kit only "does" anything once it actually has content to inject. */
export const brandKitHasContent = (kit) =>
  Boolean(kit && (kit.referenceImages?.length || kit.colorPalette?.length || kit.toneInstruction || kit.characterDescription));
