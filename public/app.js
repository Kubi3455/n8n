const $ = (id) => document.getElementById(id);

const CONTENT_TYPES = {
  video: {
    label: 'Normal Video',
    ideaLabel: 'Video fikri',
    ideaPlaceholder: 'Örn: Ürünü stüdyoda şık bir şekilde tanıtan sinematik bir video',
    dropzoneTitle: 'Referans görseli bırak',
    dropzoneHint: 'veya seçmek için tıkla · PNG, JPG, WEBP · max 20 MB',
    imageRequired: true,
    videoOptions: true,
    steps: ['Fikir ve görsel toplama', 'Görsel üretimi'],
  },
  ugc: {
    label: 'UGC Reklam',
    ideaLabel: 'Video fikri',
    ideaPlaceholder: 'Örn: Ürünü mutfak tezgahında tek çekimde tanıtan samimi bir UGC klibi',
    dropzoneTitle: 'Referans görseli bırak',
    dropzoneHint: 'veya seçmek için tıkla · PNG, JPG, WEBP · max 20 MB',
    imageRequired: true,
    videoOptions: true,
    steps: ['Fikir ve görsel toplama', 'Görsel üretimi'],
  },
  carousel: {
    label: 'Instagram Carousel',
    ideaLabel: 'Carousel konusu',
    ideaPlaceholder: 'Örn: Yeni başlayanlar için odaklanma teknikleri',
    dropzoneTitle: 'İsteğe bağlı: marka/ürün görseli',
    dropzoneHint: 'Görsel vermezsen konuya uygun bir görsel üretilir · PNG, JPG, WEBP',
    imageRequired: false,
    videoOptions: false,
    steps: ['Konu toplama', 'Carousel içerik planı', '6 slayt görseli', 'Paylaşım metni'],
  },
  character3d: {
    label: '3D Karakter',
    ideaLabel: 'Karakter konusu',
    ideaPlaceholder: 'Örn: Zırhlı bir gezgin karakteri, sıcak tonlarda',
    dropzoneTitle: 'İsteğe bağlı: karakter görseli',
    dropzoneHint: 'Görsel verirsen doğrudan 3D\'ye çevrilir · vermezsen konudan üretilir',
    imageRequired: false,
    videoOptions: false,
    steps: ['Konu ve görsel toplama', '3D karakter prompt\'u', '3D model üretimi', 'Paylaşım metni'],
  },
};

const PROJECT_TYPE_LABELS = { video: 'Normal Video', ugc: 'UGC Reklam', carousel: 'Carousel', character3d: '3D Karakter' };

const state = {
  user: null,
  settings: null,
  providers: null,
  credits: null,
  contentType: 'video',
  image: null,
  activeJobId: null,
  jobs: new Map(),
  brandKit: null,
  brandKitDraftImages: [], // settings-dialog working copy: existing hosted URLs + newly added data URLs
  feedbackTarget: null, // imageKey of the project the feedback dialog is currently open for
  feedbackRating: 0,
};

const api = async (url, options) => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `${response.status} ${response.statusText}`);
    error.code = data.code;
    throw error;
  }
  return data;
};

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

// ---------- providers -------------------------------------------------------
const PROVIDERS = [
  { key: 'openai', label: 'Metin ve görsel analizi' },
  { key: 'fal', label: 'Görsel üretimi' },
  { key: 'kie', label: 'Video üretimi' },
];

const isLive = (providers, key) => providers[key] && !providers.mockMode;

const renderMode = (providers) => {
  const pill = $('mode-pill');
  const mocked = PROVIDERS.filter((provider) => !isLive(providers, provider.key));
  pill.hidden = mocked.length === 0;
  pill.title = mocked.length
    ? 'Bazı servisler örnek verilerle çalışıyor: gerçek içerik üretilmez. Ayrıntı için tıkla.'
    : '';
};

// ---------- free credit system: see server/credits.js to remove this feature ------
const renderCredits = (credits) => {
  state.credits = credits;
  const pill = $('credits-pill');
  if (!credits || !credits.enabled || !credits.appliesNow) {
    pill.hidden = true;
    return;
  }
  pill.hidden = false;
  pill.textContent = `${credits.remaining} ücretsiz kredi`;
  pill.classList.toggle('low', credits.remaining === 0);
  updateVariantCostNote();
};

const refreshCredits = async () => {
  try {
    const status = await api('/api/status');
    renderCredits(status.credits);
  } catch {
    // Best-effort refresh; the next successful /api/status call catches up.
  }
};

const showOutOfCredits = (message) => {
  $('out-of-credits-message').textContent = message || 'Ücretsiz krediniz bitti.';
  $('out-of-credits').showModal();
};

const renderProviderStatus = (providers) => {
  $('provider-status').innerHTML = PROVIDERS
    .map((provider) => {
      const live = isLive(providers, provider.key);
      return `<div class="provider-row">
        <span style="color:var(--text)">${provider.label}</span>
        <span class="${live ? 'live' : ''}">${live ? 'canlı' : 'deneme (anahtar yok)'}</span>
      </div>`;
    })
    .join('');
};

// ---------- compose form: content type switching ----------------------------
const applyContentType = (type) => {
  state.contentType = type;
  const spec = CONTENT_TYPES[type];

  for (const button of $('content-type-picker').querySelectorAll('.content-type')) {
    button.classList.toggle('on', button.dataset.type === type);
  }

  $('dropzone-title').textContent = spec.dropzoneTitle;
  $('dropzone-hint').textContent = spec.dropzoneHint;
  $('idea-label').textContent = spec.ideaLabel;
  $('idea').placeholder = spec.ideaPlaceholder;
  $('video-options').hidden = !spec.videoOptions;
  $('format-field').hidden = !spec.videoOptions;
  $('variant-field').hidden = !spec.videoOptions;
  if (!spec.videoOptions) $('variant-count').value = '1';

  updateVariantCostNote();
  updateStartEnabled();
  emptyRun();
};

const selectedFormats = () => [...document.querySelectorAll('input[name="format"]:checked')].map((box) => box.value);

// ---------- Hook/Varyant Testi + Çoklu Format Export: see server/prompts.js (HOOK_ANGLES), ----
// server/pipeline.js. N varyant × M format = N×M kat maliyet; only worth showing while a real
// (non-mocked) run would actually charge for it.
const updateVariantCostNote = () => {
  const note = $('variant-cost-note');
  const variantCount = Number($('variant-count').value);
  const formatCount = Math.max(1, selectedFormats().length);
  const total = variantCount * formatCount;
  const costs = state.credits?.enabled && state.credits.appliesNow;
  note.hidden = total <= 1 || !costs;
  if (note.hidden) return;
  const parts = [];
  if (variantCount > 1) parts.push(`${variantCount} varyant`);
  if (formatCount > 1) parts.push(`${formatCount} format`);
  note.textContent = `${parts.join(' × ')} = ${total} kredi`;
};

const updateStartEnabled = () => {
  const spec = CONTENT_TYPES[state.contentType];
  const hasImage = Boolean(state.image);
  const hasIdea = $('idea').value.trim().length > 0;
  const hasFormat = !spec.videoOptions || selectedFormats().length > 0;
  $('start').disabled = (spec.imageRequired ? !hasImage : !(hasImage || hasIdea)) || !hasFormat;
};

const setImage = (file) => {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.image = reader.result;
    $('preview').src = reader.result;
    $('preview').hidden = false;
    $('preview-clear').hidden = false;
    $('dropzone-empty').hidden = true;
    updateStartEnabled();
  };
  reader.readAsDataURL(file);
};

const clearImage = () => {
  state.image = null;
  $('file').value = '';
  $('preview').hidden = true;
  $('preview-clear').hidden = true;
  $('dropzone-empty').hidden = false;
  updateStartEnabled();
};

const wireDropzone = () => {
  const zone = $('dropzone');
  $('file').addEventListener('change', (event) => setImage(event.target.files[0]));
  $('preview-clear').addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearImage();
  });
  zone.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target === zone) {
      event.preventDefault();
      $('file').click();
    }
  });

  for (const type of ['dragenter', 'dragover']) {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add('dragging');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.remove('dragging');
    });
  }
  zone.addEventListener('drop', (event) => setImage(event.dataTransfer.files[0]));

  $('idea').addEventListener('input', updateStartEnabled);
};

const start = async () => {
  $('compose-error').hidden = true;
  $('start').disabled = true;
  try {
    const job = await api('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentType: state.contentType,
        image: state.image,
        idea: $('idea').value,
        model: $('model').value,
        aspectRatio: selectedFormats()[0] || '16:9',
        formats: selectedFormats(),
        variantCount: Number($('variant-count').value),
        useBrandKit: $('use-brand-kit').checked,
      }),
    });
    state.activeJobId = job.id;
    upsertJob(job);
    if (job.usedFreeCredit) refreshCredits();
  } catch (error) {
    if (error.code === 'OUT_OF_CREDITS') {
      showOutOfCredits(error.message);
      renderCredits({ ...state.credits, remaining: 0 });
    } else {
      $('compose-error').textContent = error.message;
      $('compose-error').hidden = false;
    }
  } finally {
    updateStartEnabled();
  }
};

// ---------- run view: steps & log --------------------------------------------
const STATUS_LABELS = { queued: 'sırada', running: 'çalışıyor', completed: 'tamamlandı', failed: 'hata' };

const renderSteps = (steps) => {
  $('steps').innerHTML = steps
    .map((step, index) => `<li class="step ${step.status}">
      <span class="step-index">${step.status === 'done' ? '✓' : index + 1}</span>
      <span>
        <span class="step-title">${step.title}</span>
        ${step.detail ? `<br /><span class="step-detail">${escapeHtml(step.detail)}</span>` : ''}
      </span>
      ${step.status === 'running' ? '<span class="spinner"></span>' : ''}
    </li>`)
    .join('');
};

const renderLog = (job) => {
  const box = $('log');
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
  box.innerHTML = job.logs
    .map((entry) => `<div class="log-line ${entry.level}"><time>${time(entry.ts)}</time><span>${escapeHtml(entry.message)}</span></div>`)
    .join('');
  if (atBottom) box.scrollTop = box.scrollHeight;
};

/** Shows/hides every free-trial watermark badge matching `selector`. See server/credits.js. */
const setWatermarks = (selector, visible) => {
  for (const badge of document.querySelectorAll(selector)) badge.hidden = !visible;
};

// ---------- run view: video outputs (shared image + per-hook-variant results) -----------
const VARIANT_STATUS_LABELS = { pending: 'bekliyor', running: 'çalışıyor', done: 'tamamlandı', failed: 'hata' };

const renderVariantCard = (variant, usedFreeCredit) => {
  const { result } = variant;
  const stepsHtml = variant.steps
    .map((step) => `<li class="variant-step ${step.status}">
      <span class="variant-step-dot"></span>
      <span>${step.title}${step.detail ? ` — ${escapeHtml(step.detail)}` : ''}</span>
    </li>`)
    .join('');

  // Çoklu Format Export: older jobs (or a fallback single-format render) only ever had
  // `videoUrl` - normalise both shapes into the same [{ format, url }] list to render.
  const videos = result.videoUrls?.length ? result.videoUrls : (result.videoUrl ? [{ format: null, url: result.videoUrl }] : []);
  const videosHtml = videos
    .map((video) => `<div class="watermark-frame variant-format">
      ${video.format ? `<span class="format-tag">${escapeHtml(video.format)}</span>` : ''}
      <video class="variant-video" src="${video.url}" controls playsinline></video>
      <span class="watermark-badge" ${usedFreeCredit ? '' : 'hidden'}>ÜCRETSİZ DENEME</span>
    </div>`)
    .join('');
  const downloadsHtml = videos
    .map((video) => `<a class="ghost variant-download" href="${video.url}" download>${video.format ? `${video.format} indir` : 'Videoyu indir'}</a>`)
    .join('');

  return `<div class="variant-card">
    <div class="variant-head">
      <strong>${escapeHtml(variant.angleLabel || 'Varyant')}</strong>
      <span class="badge ${variant.status}">${VARIANT_STATUS_LABELS[variant.status] || variant.status}</span>
    </div>
    <ol class="variant-steps">${stepsHtml}</ol>
    <div class="variant-videos">${videosHtml}</div>
    ${result.title ? `<p class="mono variant-title">${escapeHtml(result.title)}</p>` : ''}
    ${result.caption ? `<p class="variant-caption">${escapeHtml(result.caption)}</p>` : ''}
    ${result.finalPrompt ? `<details><summary>Video prompt'u</summary><pre>${escapeHtml(result.finalPrompt)}</pre></details>` : ''}
    <div class="variant-downloads">${downloadsHtml}</div>
  </div>`;
};

const renderVideoOutputs = (job) => {
  const { result } = job;
  const hasVariants = (job.variants || []).length > 0;
  const hasAnything = result.imageDescription || result.editedImageUrl || hasVariants;
  $('outputs-video').hidden = !hasAnything;
  $('outputs-carousel').hidden = true;
  $('outputs-character3d').hidden = true;
  if (!hasAnything) return;

  const image = $('out-image');
  image.hidden = !result.editedImageUrl;
  $('out-image-empty').hidden = Boolean(result.editedImageUrl);
  if (result.editedImageUrl && image.src !== result.editedImageUrl) image.src = result.editedImageUrl;

  $('out-description').textContent = result.imageDescription || '';
  $('out-image-prompt').textContent = result.imagePrompt || '';

  setWatermarks('#outputs-video > .output-grid [data-watermark]', job.usedFreeCredit);

  $('variant-grid').innerHTML = (job.variants || [])
    .map((variant) => renderVariantCard(variant, job.usedFreeCredit))
    .join('');
};

// ---------- run view: carousel outputs (client-side text compositing) --------
const CAROUSEL_FONT = "'Manrope', ui-sans-serif, sans-serif";
const CANVAS_W = 1080;
const CANVAS_H = 1350;
const renderedCanvases = new Map(); // slide key -> canvas element, so "download all" doesn't redraw

const wrapText = (ctx, text, maxWidth) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
};

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Görsel yüklenemedi'));
  img.src = src;
});

/** Draws one slide's background + headline/body text onto a fresh canvas. */
const composeSlide = async (slide, watermark) => {
  await document.fonts.ready;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  try {
    const img = await loadImage(slide.imageUrl);
    const scale = Math.max(CANVAS_W / img.width, CANVAS_H / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (CANVAS_W - w) / 2, (CANVAS_H - h) / 2, w, h);
  } catch {
    ctx.fillStyle = '#1c212c';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // Scrim so text stays legible over any background.
  const gradient = ctx.createLinearGradient(0, CANVAS_H * 0.45, 0, CANVAS_H);
  gradient.addColorStop(0, 'rgba(10,12,16,0)');
  gradient.addColorStop(1, 'rgba(10,12,16,0.82)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, CANVAS_H * 0.45, CANVAS_W, CANVAS_H * 0.55);

  const marginX = 72;
  let y = CANVAS_H - 96;

  if (slide.body) {
    ctx.font = `500 34px ${CAROUSEL_FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    const bodyLines = wrapText(ctx, slide.body, CANVAS_W - marginX * 2).slice(0, 3);
    for (let i = bodyLines.length - 1; i >= 0; i -= 1) {
      ctx.fillText(bodyLines[i], marginX, y);
      y -= 46;
    }
    y -= 12;
  }

  if (slide.headline) {
    ctx.font = `800 62px ${CAROUSEL_FONT}`;
    ctx.fillStyle = '#ffffff';
    const headlineLines = wrapText(ctx, slide.headline, CANVAS_W - marginX * 2).slice(0, 3).reverse();
    for (const l of headlineLines) {
      ctx.fillText(l, marginX, y);
      y -= 70;
    }
  }

  // Slide index pill.
  ctx.font = `700 26px ${CAROUSEL_FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(`${slide.index}/6`, marginX, 92);

  // Free-trial watermark: baked into the pixels (unlike the video/3D screen-only overlay)
  // so a downloaded slide can't lose it. See server/credits.js to remove this feature.
  if (watermark) {
    const label = 'ÜCRETSİZ DENEME';
    ctx.font = `700 22px ${CAROUSEL_FONT}`;
    const textWidth = ctx.measureText(label).width;
    const padX = 14;
    const badgeW = textWidth + padX * 2;
    const badgeH = 38;
    const bx = CANVAS_W - badgeW - 24;
    const by = 24;
    ctx.fillStyle = 'rgba(13, 15, 20, 0.72)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, badgeW, badgeH, 8);
    else ctx.rect(bx, by, badgeW, badgeH); // older browsers without roundRect
    ctx.fill();
    ctx.strokeStyle = 'rgba(240, 180, 41, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#f0b429';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + padX, by + badgeH / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  return canvas;
};

const downloadCanvas = (canvas, fileName) => new Promise((resolve) => {
  canvas.toBlob((blob) => {
    if (!blob) return resolve(false);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    resolve(true);
  }, 'image/png');
});

const renderCarouselOutputs = async (job) => {
  const { result } = job;
  const slides = result.slides || [];
  $('outputs-video').hidden = true;
  $('outputs-carousel').hidden = slides.length === 0;
  $('outputs-character3d').hidden = true;
  if (slides.length === 0) return;

  $('carousel-count').textContent = `${slides.length} slayt`;
  $('out-carousel-caption').textContent = result.caption || '';

  const grid = $('carousel-grid');
  grid.innerHTML = '';
  renderedCanvases.clear();

  for (const slide of slides) {
    const card = document.createElement('div');
    card.className = 'carousel-card';
    card.innerHTML = `
      <div class="carousel-canvas-wrap"><span class="muted">Slayt ${slide.index} hazırlanıyor…</span></div>
      <button class="ghost carousel-download" type="button">İndir</button>
    `;
    grid.appendChild(card);

    composeSlide(slide, job.usedFreeCredit).then((canvas) => {
      renderedCanvases.set(slide.index, canvas);
      const wrap = card.querySelector('.carousel-canvas-wrap');
      wrap.innerHTML = '';
      wrap.appendChild(canvas);
      card.querySelector('.carousel-download').addEventListener('click', () => {
        downloadCanvas(canvas, `slayt-${slide.index}.png`);
      });
    });
  }
};

$('carousel-download-all').addEventListener('click', async () => {
  const entries = [...renderedCanvases.entries()].sort((a, b) => a[0] - b[0]);
  for (const [index, canvas] of entries) {
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: browsers block simultaneous downloads
    await downloadCanvas(canvas, `slayt-${index}.png`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
});

// ---------- run view: 3D character outputs ------------------------------------
const renderCharacterOutputs = (job) => {
  const { result } = job;
  const hasAnything = result.title || result.previewImageUrl || result.modelUrl;
  $('outputs-video').hidden = true;
  $('outputs-carousel').hidden = true;
  $('outputs-character3d').hidden = !hasAnything;
  if (!hasAnything) return;

  const viewer = $('model-viewer');
  const previewImg = $('character-preview');
  const previewEmpty = $('character-preview-empty');
  const downloadLink = $('model-download');
  const mockNote = $('model-mock-note');

  if (result.modelUrl) {
    if (viewer.getAttribute('src') !== result.modelUrl) viewer.setAttribute('src', result.modelUrl);
    viewer.hidden = false;
    previewImg.hidden = true;
    previewEmpty.hidden = true;
    downloadLink.href = result.modelUrl;
    downloadLink.hidden = false;
    mockNote.hidden = true;
  } else if (result.previewImageUrl) {
    viewer.hidden = true;
    previewImg.src = result.previewImageUrl;
    previewImg.hidden = false;
    previewEmpty.hidden = true;
    downloadLink.hidden = true;
    mockNote.hidden = false;
  } else {
    viewer.hidden = true;
    previewImg.hidden = true;
    previewEmpty.hidden = false;
    downloadLink.hidden = true;
    mockNote.hidden = true;
  }

  $('out-character-title').textContent = result.title || '';
  $('out-character-caption').textContent = result.caption || '';
  $('out-character-description').textContent = result.imageDescription || '';
  $('out-character-prompt').textContent = result.imagePrompt || '';

  setWatermarks('#outputs-character3d [data-watermark]', job.usedFreeCredit);
};

// ---------- run view: dispatch ------------------------------------------------
const renderOutputs = (job) => {
  if (job.contentType === 'carousel') renderCarouselOutputs(job);
  else if (job.contentType === 'character3d') renderCharacterOutputs(job);
  else renderVideoOutputs(job);
};

const renderJob = (job) => {
  $('run-title').textContent = job.result.title || `${CONTENT_TYPES[job.contentType]?.label || 'Akış'}`;
  const badge = $('run-status');
  badge.textContent = STATUS_LABELS[job.status] || job.status;
  badge.className = `badge ${job.status}`;
  renderSteps(job.steps);
  renderOutputs(job);
  renderLog(job);
};

const emptyRun = () => {
  const spec = CONTENT_TYPES[state.contentType];
  $('run-title').textContent = 'Akış';
  $('run-status').textContent = 'boşta';
  $('run-status').className = 'badge';
  $('outputs-video').hidden = true;
  $('outputs-carousel').hidden = true;
  $('outputs-character3d').hidden = true;
  $('variant-grid').innerHTML = '';
  $('log').innerHTML = '';
  $('steps').innerHTML = spec.steps
    .map((title, index) => `<li class="step pending"><span class="step-index">${index + 1}</span><span class="step-title">${title}</span><span></span></li>`)
    .join('');
};

const upsertJob = (job) => {
  state.jobs.set(job.id, job);
  if (!state.activeJobId) state.activeJobId = job.id;
  if (state.activeJobId === job.id) renderJob(job);
};

// ---------- projects ----------------------------------------------------------
const STATUS_BADGES = { processing: 'işleniyor', ready: 'hazır', error: 'hata' };

const projectThumb = (project) => {
  if (project.imageUrl) return project.imageUrl;
  if (project.slides?.[0]?.imageUrl) return project.slides[0].imageUrl;
  if (project.previewImageUrl) return project.previewImageUrl;
  return '';
};

const loadProjects = async () => {
  const projects = await api('/api/projects');
  $('library-count').textContent = `${projects.length} proje`;
  const body = $('projects').querySelector('tbody');

  if (projects.length === 0) {
    body.innerHTML = '<tr><td colspan="7" class="muted">Henüz proje yok — ilk içeriğini üret.</td></tr>';
    return;
  }

  body.innerHTML = projects
    .map((project) => {
      const thumb = projectThumb(project);
      return `<tr>
      <td>${thumb ? `<img class="row-thumb" src="${thumb}" alt="" loading="lazy" />` : '—'}</td>
      <td><span class="type-badge">${PROJECT_TYPE_LABELS[project.contentType] || project.contentType}${project.variants?.length > 1 ? ` · ${project.variants.length}x` : ''}</span></td>
      <td>${escapeHtml(project.title || '—')}</td>
      <td class="caption">${escapeHtml(project.caption || project.idea || '—')}</td>
      <td><span class="badge ${project.status}">${STATUS_BADGES[project.status] || project.status}</span></td>
      <td>${renderFeedbackCell(project)}</td>
      <td>
        ${project.videoUrl ? `<a href="${project.videoUrl}" target="_blank" rel="noopener">video</a> ` : ''}
        ${project.modelUrl ? `<a href="${project.modelUrl}" download>.glb</a> ` : ''}
        <button class="link-button" data-delete="${encodeURIComponent(project.imageKey)}" title="Projeyi sil">sil</button>
      </td>
    </tr>`;
    })
    .join('');

  for (const button of body.querySelectorAll('[data-delete]')) {
    button.addEventListener('click', async () => {
      await api(`/api/projects/${button.dataset.delete}`, { method: 'DELETE' });
      loadProjects();
    });
  }
  for (const button of body.querySelectorAll('[data-feedback]')) {
    button.addEventListener('click', () => {
      const project = projects.find((candidate) => candidate.imageKey === button.dataset.feedback);
      openFeedback(project);
    });
  }
};

// ---------- Basit Performans Geri Bildirimi ---------------------------------------
const STARS = (rating) => '★'.repeat(rating) + '☆'.repeat(5 - rating);

/** Only a finished project can be rated; anything else shows a plain dash. */
const renderFeedbackCell = (project) => {
  if (project.status !== 'ready') return '<span class="muted">—</span>';
  if (project.feedback) {
    return `<button class="link-button feedback-stars" data-feedback="${escapeHtml(project.imageKey)}" title="${escapeHtml(project.feedback.note || '')}">${STARS(project.feedback.rating)}</button>`;
  }
  return `<button class="link-button" data-feedback="${escapeHtml(project.imageKey)}">geri bildirim ver</button>`;
};

const renderFeedbackRatingPicker = () => {
  for (const button of $('feedback-rating-picker').querySelectorAll('[data-rating]')) {
    button.classList.toggle('selected', Number(button.dataset.rating) === state.feedbackRating);
  }
};

const openFeedback = (project) => {
  state.feedbackTarget = project.imageKey;
  state.feedbackRating = project.feedback?.rating || 0;
  renderFeedbackRatingPicker();
  $('feedback-note').value = project.feedback?.note || '';
  $('feedback-dialog').showModal();
};

const saveFeedback = async () => {
  if (!state.feedbackRating) return;
  await api(`/api/projects/${encodeURIComponent(state.feedbackTarget)}/feedback`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: state.feedbackRating, note: $('feedback-note').value.trim() }),
  });
  await loadProjects();
};

const wireFeedback = () => {
  for (const button of $('feedback-rating-picker').querySelectorAll('[data-rating]')) {
    button.addEventListener('click', () => {
      state.feedbackRating = Number(button.dataset.rating);
      renderFeedbackRatingPicker();
    });
  }
  $('feedback-dialog').addEventListener('close', () => {
    if ($('feedback-dialog').returnValue === 'save') saveFeedback().catch((error) => alert(error.message));
  });
};

// ---------- settings -----------------------------------------------------------
const renderSettingsForm = () => {
  $('set-model').value = state.settings.model;
  $('set-aspect').value = state.settings.aspectRatio;
  $('set-webhook').value = state.settings.webhookUrl || '';
};

const saveSettings = async () => {
  state.settings = await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: $('set-model').value.trim(),
      aspectRatio: $('set-aspect').value.trim(),
      webhookUrl: $('set-webhook').value.trim(),
    }),
  });
  $('model').value = state.settings.model;
};

// ---------- API/Webhook Access (agency layer) -----------------------------------
const renderApiKeyStatus = (status) => {
  $('api-key-status').textContent = status.active
    ? `Aktif — ${status.preview} (${new Date(status.createdAt).toLocaleDateString()})`
    : 'Henüz bir anahtar oluşturulmadı.';
  $('revoke-api-key').hidden = !status.active;
};

const loadApiKeyStatus = async () => {
  renderApiKeyStatus(await api('/api/auth/api-key'));
};

const wireApiKey = () => {
  $('generate-api-key').addEventListener('click', async () => {
    if (!confirm('Yeni bir anahtar oluşturmak eski anahtarı geçersiz kılar. Devam edilsin mi?')) return;
    try {
      const { apiKey } = await api('/api/auth/api-key', { method: 'POST' });
      $('api-key-reveal').hidden = false;
      $('api-key-reveal').value = apiKey;
      $('api-key-reveal').select();
      await loadApiKeyStatus();
    } catch (error) {
      alert(error.message);
    }
  });

  $('revoke-api-key').addEventListener('click', async () => {
    if (!confirm('API anahtarını iptal etmek istediğine emin misin?')) return;
    await api('/api/auth/api-key', { method: 'DELETE' });
    $('api-key-reveal').hidden = true;
    $('api-key-reveal').value = '';
    await loadApiKeyStatus();
  });
};

// ---------- Marka Kiti (Brand Kit) ----------------------------------------------
const brandKitHasContent = (kit) =>
  Boolean(kit && (kit.referenceImages?.length || kit.colorPalette?.length || kit.toneInstruction || kit.characterDescription));

/** Compose panel's "use brand kit" checkbox only makes sense once there's something to inject. */
const renderBrandKitField = () => {
  const hasContent = brandKitHasContent(state.brandKit);
  $('brand-kit-field').hidden = !hasContent;
  if (!hasContent) $('use-brand-kit').checked = false;
};

const renderBrandKitImages = () => {
  $('brand-kit-images').innerHTML = state.brandKitDraftImages
    .map((src, index) => `<div class="brand-kit-thumb">
      <img src="${src}" alt="" />
      <button type="button" class="brand-kit-thumb-remove" data-index="${index}" title="Kaldır">✕</button>
    </div>`)
    .join('');
  for (const button of $('brand-kit-images').querySelectorAll('[data-index]')) {
    button.addEventListener('click', () => {
      state.brandKitDraftImages.splice(Number(button.dataset.index), 1);
      renderBrandKitImages();
    });
  }
};

const renderBrandKitForm = () => {
  const kit = state.brandKit || {};
  state.brandKitDraftImages = (kit.referenceImages || []).map((ref) => ref.url);
  renderBrandKitImages();
  $('brand-kit-colors').value = (kit.colorPalette || []).join(', ');
  $('brand-kit-tone').value = kit.toneInstruction || '';
  $('brand-kit-character').value = kit.characterDescription || '';
  $('brand-kit-saved-note').hidden = true;
};

const saveBrandKit = async () => {
  state.brandKit = await api('/api/brand-kit', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      referenceImages: state.brandKitDraftImages,
      colorPalette: $('brand-kit-colors').value.split(',').map((color) => color.trim()).filter(Boolean),
      toneInstruction: $('brand-kit-tone').value.trim(),
      characterDescription: $('brand-kit-character').value.trim(),
    }),
  });
  renderBrandKitField();
};

const deleteBrandKit = async () => {
  if (!confirm('Marka kitini silmek istediğine emin misin?')) return;
  state.brandKit = await api('/api/brand-kit', { method: 'DELETE' });
  renderBrandKitForm();
  renderBrandKitField();
};

const wireBrandKit = () => {
  $('brand-kit-add-image').addEventListener('click', () => $('brand-kit-image-input').click());
  $('brand-kit-image-input').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.brandKitDraftImages.push(reader.result);
      renderBrandKitImages();
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  });
  $('delete-brand-kit').addEventListener('click', () => deleteBrandKit().catch((error) => alert(error.message)));
};

// ---------- events (SSE) --------------------------------------------------------
let events = null;

const connectEvents = () => {
  events?.close();
  const source = new EventSource('/api/events');
  events = source;
  source.onmessage = (message) => {
    const payload = JSON.parse(message.data);
    if (payload.event === 'hello') {
      for (const job of payload.jobs) state.jobs.set(job.id, job);
      const latest = payload.jobs[0];
      if (latest) {
        state.activeJobId = latest.id;
        renderJob(latest);
      }
      return;
    }
    upsertJob(payload.job);
    if (payload.event === 'status' || payload.event === 'created') loadProjects();
    // A finished job may have consumed or refunded a credit - keep the pill accurate.
    if (payload.event === 'status' && ['completed', 'failed'].includes(payload.job.status) && payload.job.usedFreeCredit) {
      refreshCredits();
    }
  };
};

// ---------- membership -----------------------------------------------------------
let authMode = 'login';

const showAuth = () => {
  $('auth').hidden = false;
  $('app').hidden = true;
  $('topbar').hidden = true;
};

const showApp = () => {
  $('auth').hidden = true;
  $('app').hidden = false;
  $('topbar').hidden = false;
};

const setAuthMode = (mode) => {
  authMode = mode;
  $('name-field').hidden = mode !== 'register';
  $('auth-submit').textContent = mode === 'register' ? 'Kayıt ol' : 'Giriş yap';
  $('auth-password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  $('auth-error').hidden = true;
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.mode === mode);
};

const wireAuth = () => {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.mode));
  }

  $('auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('auth-error').hidden = true;
    $('auth-submit').disabled = true;
    try {
      const { user } = await api(`/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: $('auth-email').value,
          password: $('auth-password').value,
          name: $('auth-name').value,
        }),
      });
      state.user = user;
      $('auth-form').reset();
      await enterApp();
    } catch (error) {
      $('auth-error').textContent = error.message;
      $('auth-error').hidden = false;
    } finally {
      $('auth-submit').disabled = false;
    }
  });

  $('logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null;
    events?.close();
    events = null;
    showAuth();
  });
};

// ---------- boot -------------------------------------------------------------
const wireContentTypePicker = () => {
  for (const button of $('content-type-picker').querySelectorAll('.content-type')) {
    button.addEventListener('click', () => {
      clearImage();
      applyContentType(button.dataset.type);
    });
  }
};

const enterApp = async () => {
  const status = await api('/api/status');
  state.user = status.user;
  state.settings = status.settings;
  state.providers = status.providers;
  state.brandKit = await api('/api/brand-kit');

  $('account-name').textContent = status.user.name || status.user.email;
  renderMode(status.providers);
  renderCredits(status.credits);
  renderSettingsForm();
  renderProviderStatus(status.providers);
  renderBrandKitField();
  $('model').value = status.settings.model;
  for (const box of document.querySelectorAll('input[name="format"]')) box.checked = box.value === status.settings.aspectRatio;
  if (selectedFormats().length === 0) document.querySelector('.format-checks input').checked = true;

  showApp();
  applyContentType(state.contentType);
  await loadProjects();
  connectEvents();
};

const init = async () => {
  wireAuth();
  setAuthMode('login');
  wireDropzone();
  wireContentTypePicker();
  applyContentType('video');

  $('start').addEventListener('click', start);
  $('variant-count').addEventListener('change', updateVariantCostNote);
  for (const box of document.querySelectorAll('input[name="format"]')) {
    box.addEventListener('change', () => {
      updateVariantCostNote();
      updateStartEnabled();
    });
  }
  wireBrandKit();
  wireFeedback();
  wireApiKey();
  const openSettings = () => {
    renderSettingsForm();
    renderBrandKitForm();
    if (state.providers) renderProviderStatus(state.providers);
    $('api-key-reveal').hidden = true;
    loadApiKeyStatus().catch((error) => console.error('API key status failed:', error));
    $('settings').showModal();
  };
  $('open-settings').addEventListener('click', openSettings);
  $('mode-pill').addEventListener('click', openSettings);
  $('settings').addEventListener('close', () => {
    if ($('settings').returnValue === 'save') {
      Promise.all([saveSettings(), saveBrandKit()]).catch((error) => alert(error.message));
    }
  });

  const { user } = await api('/api/auth/me');
  if (user) await enterApp();
  else showAuth();
};

init().catch((error) => {
  document.body.insertAdjacentHTML('afterbegin', `<p class="error" style="padding:16px">${error.message}</p>`);
});
