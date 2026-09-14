const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  settings: null,
  providers: null,
  image: null,
  selected: new Set(),
  activeJobId: null,
  jobs: new Map(),
};

const api = async (url, options) => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
};

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

// ---------- providers -------------------------------------------------------
const PROVIDERS = [
  { key: 'openai', label: 'Metin ve görsel analizi' },
  { key: 'fal', label: 'Görsel üretimi' },
  { key: 'kie', label: 'Video üretimi' },
  { key: 'blotato', label: 'Sosyal medya paylaşımı' },
];

const isLive = (providers, key) => providers[key] && !providers.mockMode;

/**
 * Tek bir gösterge: bir servis bile örnek verilerle çalışıyorsa görünür,
 * hepsi canlıya geçtiğinde kendiliğinden kaybolur.
 */
const renderMode = (providers) => {
  const pill = $('mode-pill');
  const mocked = PROVIDERS.filter((provider) => !isLive(providers, provider.key));
  pill.hidden = mocked.length === 0;
  pill.title = mocked.length
    ? 'Bazı servisler örnek verilerle çalışıyor: gerçek video üretilmez, paylaşım yapılmaz. Ayrıntı için tıkla.'
    : '';
};

/** Ayrıntılı durum yalnızca Ayarlar penceresinde. */
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

// ---------- compose form ----------------------------------------------------
const renderPlatformPicker = () => {
  $('platform-picker').innerHTML = state.settings.platforms
    .map((platform) => {
      const on = state.selected.has(platform.id);
      const unconfigured = !platform.accountId;
      return `<label class="platform-toggle ${on ? 'on' : ''} ${unconfigured ? 'unconfigured' : ''}" title="${unconfigured ? 'Hesap kimliği ayarlanmadı' : platform.accountId}">
        <input type="checkbox" value="${platform.id}" ${on ? 'checked' : ''} />${platform.label}
      </label>`;
    })
    .join('');

  for (const input of $('platform-picker').querySelectorAll('input')) {
    input.addEventListener('change', () => {
      if (input.checked) state.selected.add(input.value);
      else state.selected.delete(input.value);
      renderPlatformPicker();
    });
  }
};

const setImage = (file) => {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.image = reader.result;
    $('preview').src = reader.result;
    $('preview').hidden = false;
    $('dropzone-empty').hidden = true;
    $('start').disabled = false;
  };
  reader.readAsDataURL(file);
};

const wireDropzone = () => {
  const zone = $('dropzone');
  $('file').addEventListener('change', (event) => setImage(event.target.files[0]));

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
};

const start = async () => {
  $('compose-error').hidden = true;
  $('start').disabled = true;
  try {
    const job = await api('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: state.image,
        idea: $('idea').value,
        model: $('model').value,
        aspectRatio: $('aspect').value,
        platforms: [...state.selected],
      }),
    });
    state.activeJobId = job.id;
    upsertJob(job);
  } catch (error) {
    $('compose-error').textContent = error.message;
    $('compose-error').hidden = false;
  } finally {
    $('start').disabled = !state.image;
  }
};

// ---------- run view --------------------------------------------------------
const STATUS_LABELS = { queued: 'sırada', running: 'çalışıyor', completed: 'tamamlandı', failed: 'hata' };

const renderSteps = (job) => {
  $('steps').innerHTML = job.steps
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

const renderOutputs = (job) => {
  const { result } = job;
  const hasAnything = result.imageDescription || result.editedImageUrl || result.videoUrl;
  $('outputs').hidden = !hasAnything;
  if (!hasAnything) return;

  const image = $('out-image');
  image.hidden = !result.editedImageUrl;
  $('out-image-empty').hidden = Boolean(result.editedImageUrl);
  if (result.editedImageUrl && image.src !== result.editedImageUrl) image.src = result.editedImageUrl;

  const video = $('out-video');
  video.hidden = !result.videoUrl;
  $('out-video-empty').hidden = Boolean(result.videoUrl);
  if (result.videoUrl && video.src !== result.videoUrl) video.src = result.videoUrl;

  $('out-title').textContent = result.title || '';
  $('out-caption').textContent = result.caption || '';
  $('out-description').textContent = result.imageDescription || '';
  $('out-image-prompt').textContent = result.imagePrompt || '';
  $('out-final-prompt').textContent = result.finalPrompt || '';

  $('posts').innerHTML = (result.posts || [])
    .map((post) => `<div class="post ${post.status}">
      <strong>${post.label}</strong>
      <span>${post.status} — ${escapeHtml(post.detail || '')}</span>
    </div>`)
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

const renderJob = (job) => {
  $('run-title').textContent = job.result.title || `Akış · ${job.imageKey}`;
  const badge = $('run-status');
  badge.textContent = STATUS_LABELS[job.status] || job.status;
  badge.className = `badge ${job.status}`;
  renderSteps(job);
  renderOutputs(job);
  renderLog(job);
};

const emptyRun = () => {
  $('steps').innerHTML = ['Fikir & görsel toplama', 'NanoBanana ile görsel', 'Video senaryosu', 'VEO3 ile video', 'Tüm platformlara paylaşım']
    .map((title, index) => `<li class="step pending"><span class="step-index">${index + 1}</span><span class="step-title">${title}</span><span></span></li>`)
    .join('');
};

const upsertJob = (job) => {
  state.jobs.set(job.id, job);
  if (!state.activeJobId) state.activeJobId = job.id;
  if (state.activeJobId === job.id) renderJob(job);
};

// ---------- projects --------------------------------------------------------
const STATUS_BADGES = {
  processing: 'işleniyor',
  ready: 'hazır',
  published: 'yayınlandı',
  error: 'hata',
};

const loadProjects = async () => {
  const projects = await api('/api/projects');
  $('library-count').textContent = `${projects.length} proje`;
  const body = $('projects').querySelector('tbody');

  if (projects.length === 0) {
    body.innerHTML = '<tr><td colspan="5" class="muted">Henüz proje yok — ilk videonu üret.</td></tr>';
    return;
  }

  body.innerHTML = projects
    .map((project) => `<tr>
      <td>${project.imageUrl ? `<img class="row-thumb" src="${project.imageUrl}" alt="" loading="lazy" />` : '—'}</td>
      <td>${escapeHtml(project.title || '—')}</td>
      <td class="caption">${escapeHtml(project.caption || project.idea || '—')}</td>
      <td><span class="badge ${project.status}">${STATUS_BADGES[project.status] || project.status}</span></td>
      <td>
        ${project.videoUrl ? `<a href="${project.videoUrl}" target="_blank" rel="noopener">video</a> ` : ''}
        <button class="link-button" data-delete="${project.imageKey}" title="Projeyi sil">sil</button>
      </td>
    </tr>`)
    .join('');

  for (const button of body.querySelectorAll('[data-delete]')) {
    button.addEventListener('click', async () => {
      await api(`/api/projects/${button.dataset.delete}`, { method: 'DELETE' });
      loadProjects();
    });
  }
};

// ---------- settings --------------------------------------------------------
const renderSettingsForm = () => {
  $('set-model').value = state.settings.model;
  $('set-aspect').value = state.settings.aspectRatio;
  $('settings-platforms').innerHTML = state.settings.platforms
    .map((platform) => `<div class="settings-platform" data-platform="${platform.id}">
      <header>
        <strong>${platform.label}</strong>
        <label class="muted"><input type="checkbox" data-field="enabled" ${platform.enabled ? 'checked' : ''} /> aktif</label>
      </header>
      <input type="text" data-field="accountId" placeholder="Blotato account id" value="${platform.accountId || ''}" />
      ${platform.id === 'facebook' ? `<input type="text" data-field="pageId" placeholder="Facebook page id" value="${platform.pageId || ''}" />` : ''}
      ${platform.id === 'pinterest' ? `<input type="text" data-field="boardId" placeholder="Pinterest board id" value="${platform.boardId || ''}" />` : ''}
    </div>`)
    .join('');
};

const saveSettings = async () => {
  const platforms = [...$('settings-platforms').querySelectorAll('.settings-platform')].map((node) => {
    const platform = { id: node.dataset.platform };
    for (const input of node.querySelectorAll('[data-field]')) {
      platform[input.dataset.field] = input.type === 'checkbox' ? input.checked : input.value.trim();
    }
    return platform;
  });

  state.settings = await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: $('set-model').value.trim(), aspectRatio: $('set-aspect').value.trim(), platforms }),
  });

  state.selected = new Set(state.settings.platforms.filter((platform) => platform.enabled).map((platform) => platform.id));
  renderPlatformPicker();
};

// ---------- misc ------------------------------------------------------------
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

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
  };
};

// ---------- membership ------------------------------------------------------
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

// ---------- boot ------------------------------------------------------------
const enterApp = async () => {
  const status = await api('/api/status');
  state.user = status.user;
  state.settings = status.settings;
  state.providers = status.providers;
  state.selected = new Set(status.settings.platforms.filter((platform) => platform.enabled).map((platform) => platform.id));

  $('account-name').textContent = status.user.name || status.user.email;
  renderMode(status.providers);
  renderPlatformPicker();
  renderSettingsForm();
  renderProviderStatus(status.providers);
  $('model').value = status.settings.model;
  $('aspect').value = status.settings.aspectRatio;

  showApp();
  emptyRun();
  await loadProjects();
  connectEvents();
};

const init = async () => {
  emptyRun();
  wireAuth();
  setAuthMode('login');
  wireDropzone();

  $('start').addEventListener('click', start);
  const openSettings = () => {
    renderSettingsForm();
    if (state.providers) renderProviderStatus(state.providers);
    $('settings').showModal();
  };
  $('open-settings').addEventListener('click', openSettings);
  $('mode-pill').addEventListener('click', openSettings);
  $('settings').addEventListener('close', () => {
    if ($('settings').returnValue === 'save') saveSettings().catch((error) => alert(error.message));
  });

  const { user } = await api('/api/auth/me');
  if (user) await enterApp();
  else showAuth();
};

init().catch((error) => {
  document.body.insertAdjacentHTML('afterbegin', `<p class="error" style="padding:16px">${error.message}</p>`);
});
