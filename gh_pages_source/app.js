/**
 * VulcanoCraft Resource Pack Dashboard
 * Dynamic GitHub Release 1.0 Data & Mirror Processing
 */

const CONFIG = {
  GITHUB_REPO: 'VulcanoSoftware/vulcanocraft_resourcepack',
  RELEASE_TAG: '1.0',
  API_RELEASE_URL: 'https://api.github.com/repos/VulcanoSoftware/vulcanocraft_resourcepack/releases/tags/1.0',
  MIRRORS_FILE: '../mirrors.txt',
  REFRESH_INTERVAL_MS: 300000 // 5 minutes auto refresh
};

// Application State
const state = {
  packs: [],           // Array of parsed pack objects
  githubRelease: null, // GitHub API response
  mirrorsData: [],     // Raw parsed lines from mirrors.txt
  activeFilter: 'all', // 'all' | 'github' | 'gitlab' | 'sourceforge'
  searchQuery: ''      // Active search string
};

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
});

async function initApp() {
  const container = document.getElementById('packs-container');
  if (container && state.packs.length === 0) {
    container.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Resource packs ophalen uit Release 1.0...</p>
      </div>
    `;
  }

  try {
    await Promise.all([
      fetchGitHubRelease(),
      fetchMirrorsTxt()
    ]);

    processAndCombineData();
    renderStats();
    renderPacks();
  } catch (err) {
    console.error('Fout bij laden van live data:', err);
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <p>⚠️ Kon live release data niet ophalen van GitHub API.</p>
        </div>
      `;
    }
  }
}

/**
 * Setup Event Listeners
 */
function setupEventListeners() {
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      renderPacks();
    });
  }

  const filterContainer = document.getElementById('mirror-filters');
  if (filterContainer) {
    filterContainer.addEventListener('click', (e) => {
      const button = e.target.closest('.pill');
      if (!button) return;

      filterContainer.querySelectorAll('.pill').forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');

      state.activeFilter = button.getAttribute('data-filter') || 'all';
      renderPacks();
    });
  }

  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      initApp();
      showToast('Data wordt ververst...');
    });
  }

  setInterval(initApp, CONFIG.REFRESH_INTERVAL_MS);
}

/**
 * Fetch GitHub Release 1.0
 */
async function fetchGitHubRelease() {
  try {
    const res = await fetch(CONFIG.API_RELEASE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.githubRelease = await res.json();
  } catch (err) {
    console.warn('GitHub release API fetch mislukt:', err);
  }
}

/**
 * Fetch and Parse mirrors.txt
 */
async function fetchMirrorsTxt() {
  const filePaths = [CONFIG.MIRRORS_FILE, './mirrors.txt', '/mirrors.txt'];
  let text = '';
  for (const path of filePaths) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        text = await res.text();
        if (text && (text.includes('gitlab:') || text.includes('sourceforge:'))) {
          break;
        }
      }
    } catch (e) {}
  }

  if (text) {
    state.mirrorsData = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && (line.startsWith('gitlab:') || line.startsWith('sourceforge:')));
  } else {
    state.mirrorsData = [];
  }
}

/**
 * Process GitHub Release assets and mirrors.txt
 */
function processAndCombineData() {
  const packsMap = new Map();

  function getOrCreatePack(filename) {
    const key = filename.toLowerCase();
    if (!packsMap.has(key)) {
      packsMap.set(key, {
        name: filename,
        key: key,
        size: null,
        updatedAt: null,
        downloads: 0,
        sha1: null,
        sha1Url: null,
        mirrors: {
          github: `https://github.com/${CONFIG.GITHUB_REPO}/releases/download/${CONFIG.RELEASE_TAG}/${filename}`,
          gitlab: null,
          sourceforge: null
        }
      });
    }
    return packsMap.get(key);
  }

  // 1. Process GitHub assets
  if (state.githubRelease && Array.isArray(state.githubRelease.assets)) {
    state.githubRelease.assets.forEach(asset => {
      const name = asset.name;
      if (name.toLowerCase().endsWith('.sha1')) {
        const zipName = name.substring(0, name.length - 5);
        const pack = getOrCreatePack(zipName);
        pack.sha1Url = asset.browser_download_url;
      } else {
        const pack = getOrCreatePack(name);
        pack.size = asset.size;
        pack.updatedAt = new Date(asset.updated_at || asset.created_at);
        pack.downloads = asset.download_count || 0;
        pack.mirrors.github = asset.browser_download_url;
      }
    });
  }

  // 2. Process mirrors.txt
  state.mirrorsData.forEach(line => {
    const firstColonIdx = line.indexOf(':');
    if (firstColonIdx === -1) return;

    const type = line.substring(0, firstColonIdx).toLowerCase().trim();
    const url = line.substring(firstColonIdx + 1).trim();

    // Parse filename from URL
    let cleanUrl = url.replace(/\/download$/, '');
    const urlParts = cleanUrl.split('/');
    const filename = urlParts[urlParts.length - 1];

    if (!filename) return;

    if (filename.toLowerCase().endsWith('.sha1')) {
      const mainName = filename.substring(0, filename.length - 5);
      const pack = getOrCreatePack(mainName);
      if (!pack.sha1Url) pack.sha1Url = url;
    } else {
      const pack = getOrCreatePack(filename);
      if (type === 'gitlab') pack.mirrors.gitlab = url;
      if (type === 'sourceforge') pack.mirrors.sourceforge = url;
    }
  });

  state.packs = Array.from(packsMap.values());

  // Fetch SHA-1 strings live
  fetchSha1Hashes();
}

/**
 * Fetch SHA-1 hash strings asynchronously
 */
async function fetchSha1Hashes() {
  for (const pack of state.packs) {
    if (pack.sha1) continue;
    const sha1Url = pack.sha1Url || `${pack.mirrors.github}.sha1`;
    try {
      const res = await fetch(sha1Url);
      if (res.ok) {
        const hash = await res.text();
        pack.sha1 = hash.trim();
        updatePackSha1Dom(pack.key, pack.sha1);
      }
    } catch (e) {
      // CORS or network fallback
    }
  }
}

/**
 * Render Top Stats Overview
 */
function renderStats() {
  const totalPacksEl = document.getElementById('stat-total-packs');
  const totalDownloadsEl = document.getElementById('stat-total-downloads');
  const lastUpdatedEl = document.getElementById('stat-last-updated');

  if (totalPacksEl) totalPacksEl.textContent = state.packs.length;

  const totalDownloads = state.packs.reduce((acc, p) => acc + (p.downloads || 0), 0);
  if (totalDownloadsEl) totalDownloadsEl.textContent = totalDownloads > 0 ? totalDownloads.toLocaleString('nl-NL') : '0';

  let latestDate = null;
  if (state.githubRelease && state.githubRelease.published_at) {
    latestDate = new Date(state.githubRelease.published_at);
  }
  state.packs.forEach(p => {
    if (p.updatedAt && (!latestDate || p.updatedAt > latestDate)) {
      latestDate = p.updatedAt;
    }
  });

  if (lastUpdatedEl) {
    lastUpdatedEl.textContent = latestDate
      ? latestDate.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
      : 'Release 1.0';
  }

  updateFilterCounts();
}

/**
 * Update filter counts in pills
 */
function updateFilterCounts() {
  const countAll = document.getElementById('count-all');
  const countGithub = document.getElementById('count-github');
  const countGitlab = document.getElementById('count-gitlab');
  const countSourceforge = document.getElementById('count-sourceforge');

  if (countAll) countAll.textContent = state.packs.length;
  if (countGithub) countGithub.textContent = state.packs.filter(p => !!p.mirrors.github).length;
  if (countGitlab) countGitlab.textContent = state.packs.filter(p => !!p.mirrors.gitlab).length;
  if (countSourceforge) countSourceforge.textContent = state.packs.filter(p => !!p.mirrors.sourceforge).length;
}

/**
 * Render Pack Cards Grid
 */
function renderPacks() {
  const container = document.getElementById('packs-container');
  const resultsCountEl = document.getElementById('results-count');
  if (!container) return;

  const filtered = state.packs.filter(pack => {
    if (state.searchQuery && !pack.name.toLowerCase().includes(state.searchQuery)) {
      return false;
    }
    if (state.activeFilter !== 'all') {
      if (!pack.mirrors[state.activeFilter]) return false;
    }
    return true;
  });

  if (resultsCountEl) {
    resultsCountEl.textContent = `${filtered.length} bestand${filtered.length === 1 ? '' : 'en'}`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>🔍 Geen bestanden gevonden voor de geselecteerde zoekopdracht of filter.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(createPackCardHtml).join('');
}

/**
 * Generate HTML for single Pack Card
 */
function createPackCardHtml(pack) {
  const safeDomId = pack.key.replace(/[^a-z0-9]/gi, '_');
  const formattedSize = pack.size ? (pack.size / (1024 * 1024)).toFixed(2) + ' MB' : 'Grootte onbekend';
  const extension = pack.name.includes('.') ? pack.name.split('.').pop().toUpperCase() : 'ZIP';

  // Minecraft command
  const assignCmd = `/assignpack %player% ${pack.mirrors.github} auto`;

  return `
    <article class="pack-card" data-key="${pack.key}">
      <div class="pack-card-header">
        <div class="pack-title-row">
          <h3 class="pack-title">${escapeHtml(pack.name)}</h3>
          <span class="file-tag">${escapeHtml(extension)}</span>
        </div>
      </div>

      <div class="pack-meta-row">
        <span>📦 ${formattedSize}</span>
        <span>📥 ${pack.downloads ? pack.downloads.toLocaleString('nl-NL') : 0} downloads</span>
      </div>

      <!-- Minecraft Command Snippet -->
      <div class="code-box">
        <div class="code-box-header">
          <span>Minecraft Plugin Commando</span>
          <button class="copy-btn" onclick="copyToClipboard('${escapeJs(assignCmd)}', 'Commando gekopieerd!')">
            📋 Kopieer
          </button>
        </div>
        <div class="code-box-content">${escapeHtml(assignCmd)}</div>
      </div>

      <!-- SHA1 Hash Snippet -->
      <div class="code-box">
        <div class="code-box-header">
          <span>SHA-1 Hash</span>
          <button class="copy-btn" onclick="copyToClipboard(document.getElementById('sha1-${safeDomId}').innerText, 'SHA-1 hash gekopieerd!')">
            📋 Kopieer
          </button>
        </div>
        <div class="code-box-content" id="sha1-${safeDomId}">${pack.sha1 ? escapeHtml(pack.sha1) : 'Laden...'}</div>
      </div>

      <!-- Mirrors / Downloads -->
      <div class="mirror-links">
        <span class="mirror-links-label">Download Optics & Mirrors:</span>
        <div class="mirror-buttons-grid">
          ${pack.mirrors.github ? `
            <a href="${pack.mirrors.github}" target="_blank" rel="noopener" class="mirror-btn github">
              <span>🐙 GitHub</span>
              <span>Download ↗</span>
            </a>
          ` : ''}
          ${pack.mirrors.gitlab ? `
            <a href="${pack.mirrors.gitlab}" target="_blank" rel="noopener" class="mirror-btn gitlab">
              <span>🦊 GitLab Mirror</span>
              <span>Download ↗</span>
            </a>
          ` : ''}
          ${pack.mirrors.sourceforge ? `
            <a href="${pack.mirrors.sourceforge}" target="_blank" rel="noopener" class="mirror-btn sourceforge">
              <span>🚀 SourceForge Mirror</span>
              <span>Download ↗</span>
            </a>
          ` : ''}
        </div>
      </div>
    </article>
  `;
}

/**
 * Update DOM element with SHA-1
 */
function updatePackSha1Dom(key, sha1) {
  const safeDomId = key.replace(/[^a-z0-9]/gi, '_');
  const el = document.getElementById(`sha1-${safeDomId}`);
  if (el) {
    el.textContent = sha1;
  }
}

/**
 * Toast Notification Helper
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

/**
 * Copy to Clipboard Helper
 */
function copyToClipboard(text, successMessage = 'Gekopieerd!') {
  if (!text || text === 'Laden...') return;
  navigator.clipboard.writeText(text).then(() => {
    showToast(successMessage);
  }).catch(err => {
    console.error('Kopiëren mislukt:', err);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJs(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"');
}

window.copyToClipboard = copyToClipboard;
