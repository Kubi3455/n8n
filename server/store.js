import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from './config.js';

const PROJECTS_FILE = path.join(paths.data, 'projects.json');
const SETTINGS_FILE = path.join(paths.data, 'settings.json');

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
      variants: [], // video/ugc only, when >1 hook variant was requested: [{ id, angle, angleLabel, status, title, caption, videoUrl, finalPrompt }]
      slides: [], // carousel only: [{ index, imageUrl, headline, body }]
      modelUrl: '', // character3d only: downloadable .glb mesh
      previewImageUrl: '', // character3d only: rendered turntable preview
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
