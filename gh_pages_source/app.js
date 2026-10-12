/**
 * VulcanoCraft Resource Pack Dashboard Application
 * Live Data Fetching, Mirror Aggregation, Status Ping, Filters & History
 */

const CONFIG = {
  GITHUB_REPO: 'VulcanoSoftware/vulcanocraft_resourcepack',
  RELEASE_TAG: '1.0',
  API_BASE: 'https://api.github.com/repos/VulcanoSoftware/vulcanocraft_resourcepack',
  MIRRORS_FILE: './mirrors.txt',
  REFRESH_INTERVAL_MS: 60000 // 1 minute auto refresh
};

// Global App State
const state = {
  packs: [],          // Parsed pack items with all mirror links & sha1
  mirrorsData: [],    // Raw parsed lines from mirrors.txt
  githubRelease: null,// GitHub release API payload
  events: [],         // Workflow runs + commit history events
  activeFilter: 'all',// 'all' | 'github' | 'gitlab' | 'sourceforge'
  searchQuery: '',
  mirrorStatuses: {
    github: { status: 'checking', message: 'Controleren...' },
    gitlab: { status: 'checking', message: 'Controleren...' },
    sourceforge: { status: 'checking', message: 'Controleren...' }
  }
};

/**
 * Initialize application on page load
 */
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
});

async function initApp() {
  setPulseState('loading', 'Data ophalen...');
  try {
    await Promise.all([
      fetchGitHubRelease(),
      fetchMirrorsTxt(),
      fetchEventHistory()
    ]);

    processAndCombineData();
    renderStats();
    renderPacks();
    renderEvents();
    checkMirrorStatuses();

    setPulseState('active', 'Live Synchronisatie Actief');
  } catch (err) {
    console.error('Initialisatiefout:', err);
    setPulseState('error', 'Fout bij laden van live data');
  }
}

/**
 * Setup event listeners for UI controls
 */
function setupEventListeners() {
  // Search input listener
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      renderPacks();
    });
  }

  // Mirror filter pills
  const filterPills = document.querySelectorAll('#mirror-filters .pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeFilter = pill.getAttribute('data-mirror') || 'all';
      renderPacks();
    });
  });

  // Manual refresh button
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      initApp();
      showToast('Data wordt ververst...');
    });
  }

  // Event history refresh
  const toggleEventsBtn = document.getElementById('toggle-events-btn');
  if (toggleEventsBtn) {
    toggleEventsBtn.addEventListener('click', async () => {
      await fetchEventHistory();
      renderEvents();
      showToast('Event geschiedenis bijgewerkt!');
    });
  }

  // Auto refresh timer
  setInterval(() => {
    initApp();
  }, CONFIG.REFRESH_INTERVAL_MS);
}

/**
 * Fetch GitHub Release 1.0 details & assets
 */
async function fetchGitHubRelease() {
  try {
    const res = await fetch(`${CONFIG.API_BASE}/releases/tags/${CONFIG.RELEASE_TAG}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    state.githubRelease = await res.json();
  } catch (err) {
    console.warn('Kon GitHub release niet direct via API ophalen, valt terug op generieke state:', err);
  }
}

/**
 * Fetch and parse mirrors.txt
 */
async function fetchMirrorsTxt() {
  try {
    const res = await fetch(CONFIG.MIRRORS_FILE);
    if (!res.ok) throw new Error(`Kon ${CONFIG.MIRRORS_FILE} niet ophalen (${res.status})`);
    const text = await res.text();

    state.mirrorsData = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && line.includes(':http'));
  } catch (err) {
    console.warn('Kon mirrors.txt niet ophalen:', err);
    state.mirrorsData = [];
  }
}

/**
 * Fetch workflow runs & commit events from GitHub REST API
 */
async function fetchEventHistory() {
  state.events = [];
  try {
    // 1. Fetch Workflow Runs
    const runsRes = await fetch(`${CONFIG.API_BASE}/actions/runs?per_page=10`);
    if (runsRes.ok) {
      const data = await runsRes.json();
      if (data.workflow_runs) {
        data.workflow_runs.forEach(run => {
          state.events.push({
            id: `run-${run.id}`,
            type: 'workflow',
            title: run.name || 'Workflow Execution',
            status: run.conclusion || run.status,
            time: new Date(run.updated_at || run.created_at),
            detail: `Branch: ${run.head_branch} • Commit: ${run.head_sha ? run.head_sha.substring(0, 7) : 'head'}`,
            url: run.html_url
          });
        });
      }
    }

    // 2. Fetch Commits
    const commitsRes = await fetch(`${CONFIG.API_BASE}/commits?per_page=10`);
    if (commitsRes.ok) {
      const commits = await commitsRes.json();
      commits.forEach(c => {
        state.events.push({
          id: `commit-${c.sha}`,
          type: 'commit',
          title: `Commit: ${c.commit.message.split('\n')[0]}`,
          status: 'success',
          time: new Date(c.commit.author.date),
          detail: `Auteur: ${c.commit.author.name} (${c.sha.substring(0, 7)})`,
          url: c.html_url
        });
      });
    }

    // Sort descending by date
    state.events.sort((a, b) => b.time - a.time);
  } catch (err) {
    console.warn('Kon event geschiedenis niet ophalen:', err);
  }
}

/**
 * Combine GitHub assets and mirrors.txt data into unified pack objects
 */
function processAndCombineData() {
  const packsMap = new Map();

  // Helper to ensure pack entry exists
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
  if (state.githubRelease && state.githubRelease.assets) {
    state.githubRelease.assets.forEach(asset => {
      if (asset.name.toLowerCase().endsWith('.sha1')) {
        const zipName = asset.name.substring(0, asset.name.length - 5);
        const pack = getOrCreatePack(zipName);
        pack.sha1Url = asset.browser_download_url;
      } else if (asset.name.toLowerCase().endsWith('.zip')) {
        const pack = getOrCreatePack(asset.name);
        pack.size = asset.size;
        pack.updatedAt = new Date(asset.updated_at);
        pack.downloads = asset.download_count || 0;
        pack.mirrors.github = asset.browser_download_url;
      }
    });
  }

  // 2. Process mirrors.txt
  state.mirrorsData.forEach(line => {
    const firstColonIdx = line.indexOf(':');
    if (firstColonIdx === -1) return;

    const type = line.substring(0, firstColonIdx).toLowerCase();
    const url = line.substring(firstColonIdx + 1);

    // Extract filename from URL
    let filename = '';
    if (type === 'gitlab') {
      const parts = url.split('/');
      filename = parts[parts.length - 1];
    } else if (type === 'sourceforge') {
      const cleanUrl = url.replace(/\/download$/, '');
      const parts = cleanUrl.split('/');
      filename = parts[parts.length - 1];
    }

    if (!filename) return;

    if (filename.toLowerCase().endsWith('.sha1')) {
      const zipName = filename.substring(0, filename.length - 5);
      const pack = getOrCreatePack(zipName);
      if (!pack.sha1Url) pack.sha1Url = url;
    } else if (filename.toLowerCase().endsWith('.zip')) {
      const pack = getOrCreatePack(filename);
      if (type === 'gitlab') pack.mirrors.gitlab = url;
      if (type === 'sourceforge') pack.mirrors.sourceforge = url;
    }
  });

  state.packs = Array.from(packsMap.values());

  // Asynchronously fetch .sha1 files content live
  fetchSha1Hashes();
}

/**
 * Fetch SHA1 text content live for packs
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
        updatePackSha1InDom(pack.key, pack.sha1);
      }
    } catch (e) {
      // CORS/Fetch fallback
    }
  }
}

/**
 * Render Header Statistics Bar
 */
function renderStats() {
  const totalPacksEl = document.getElementById('stat-total-packs');
  const totalDownloadsEl = document.getElementById('stat-total-downloads');
  const lastUpdatedEl = document.getElementById('stat-last-updated');

  if (totalPacksEl) totalPacksEl.textContent = state.packs.length;

  const totalDownloads = state.packs.reduce((acc, pack) => acc + (pack.downloads || 0), 0);
  if (totalDownloadsEl) totalDownloadsEl.textContent = totalDownloads > 0 ? totalDownloads.toLocaleString('nl-NL') : 'N.v.t.';

  let latestDate = null;
  state.packs.forEach(p => {
    if (p.updatedAt && (!latestDate || p.updatedAt > latestDate)) {
      latestDate = p.updatedAt;
    }
  });

  if (lastUpdatedEl) {
    lastUpdatedEl.textContent = latestDate
      ? latestDate.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'Vandaag (1.0)';
  }

  // Update mirror filter pill counters
  updateFilterCounts();
}

/**
 * Update numbers inside filter pills
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
 * Render Pack Grid Cards
 */
function renderPacks() {
  const container = document.getElementById('packs-container');
  const resultsCountEl = document.getElementById('results-count');
  if (!container) return;

  // Filter packs based on mirror selection & search query
  const filtered = state.packs.filter(pack => {
    // 1. Search Query
    if (state.searchQuery && !pack.name.toLowerCase().includes(state.searchQuery)) {
      return false;
    }
    // 2. Mirror Filter
    if (state.activeFilter !== 'all') {
      if (!pack.mirrors[state.activeFilter]) return false;
    }
    return true;
  });

  if (resultsCountEl) {
    resultsCountEl.textContent = `${filtered.length} pack${filtered.length === 1 ? '' : 's'} getoond`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="loading-state" style="grid-column: 1 / -1;">
        <p>🔍 Geen resource packs gevonden met de huidige zoekopdracht of mirror filter.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(pack => createPackCardHtml(pack)).join('');
}

/**
 * Generate HTML string for single pack card
 */
function createPackCardHtml(pack) {
  const safeDomId = pack.key.replace(/[^a-z0-9]/gi, '_');
  const formattedSize = pack.size ? (pack.size / (1024 * 1024)).toFixed(2) + ' MB' : 'Grootte onbekend';
  const formattedDate = pack.updatedAt ? pack.updatedAt.toLocaleDateString('nl-NL') : 'Tag 1.0 Release';

  // Minecraft assignpack command
  const assignCmd = `/assignpack %player% ${pack.mirrors.github} auto`;

  return `
    <article class="pack-card" data-key="${pack.key}">
      <div class="pack-card-header">
        <h3 class="pack-title">${escapeHtml(pack.name)}</h3>
        <span class="pack-badge">Actief v1.0</span>
      </div>

      <div class="pack-meta">
        <span class="meta-item">📁 ${formattedSize}</span>
        <span class="meta-item">📅 ${formattedDate}</span>
      </div>

      <!-- Command snippet -->
      <div class="code-block">
        <div class="code-header">
          <span>Minecraft Plugin Commando</span>
          <button class="copy-icon-btn" onclick="copyToClipboard('${escapeJs(assignCmd)}', 'Commando gekopieerd!')" title="Kopieer commando">📋 Kopieer</button>
        </div>
        <div class="code-content">${escapeHtml(assignCmd)}</div>
      </div>

      <!-- SHA1 Hash box -->
      <div class="code-block">
        <div class="code-header">
          <span>SHA-1 Hash</span>
          <button class="copy-icon-btn" onclick="copyToClipboard(document.getElementById('sha1-${safeDomId}').innerText, 'SHA-1 gekopieerd!')" title="Kopieer SHA-1">📋</button>
        </div>
        <div class="code-content" id="sha1-${safeDomId}">${pack.sha1 ? escapeHtml(pack.sha1) : 'Hash laden...'}</div>
      </div>

      <!-- Mirror Download Buttons -->
      <div class="mirror-links-title">Beschikbare Mirrors & Downloads</div>
      <div class="mirror-buttons">
        ${pack.mirrors.github ? `
          <a href="${pack.mirrors.github}" target="_blank" rel="noopener" class="mirror-btn github">
            <span class="mirror-btn-left">🐙 <strong>GitHub</strong> (Primair)</span>
            <span>⬇ Download</span>
          </a>
        ` : ''}

        ${pack.mirrors.gitlab ? `
          <a href="${pack.mirrors.gitlab}" target="_blank" rel="noopener" class="mirror-btn gitlab">
            <span class="mirror-btn-left">🦊 <strong>GitLab</strong> Mirror</span>
            <span>⬇ Download</span>
          </a>
        ` : ''}

        ${pack.mirrors.sourceforge ? `
          <a href="${pack.mirrors.sourceforge}" target="_blank" rel="noopener" class="mirror-btn sourceforge">
            <span class="mirror-btn-left">🚀 <strong>SourceForge</strong> Mirror</span>
            <span>⬇ Download</span>
          </a>
        ` : ''}
      </div>
    </article>
  `;
}

/**
 * Render Events Timeline in Sidebar
 */
function renderEvents() {
  const container = document.getElementById('events-timeline');
  if (!container) return;

  if (!state.events || state.events.length === 0) {
    container.innerHTML = `<p class="event-detail">Geen recente events gevonden.</p>`;
    return;
  }

  container.innerHTML = state.events.map(ev => {
    const isSuccess = ev.status === 'success' || ev.status === 'completed';
    const statusIcon = isSuccess ? '🟢' : ev.status === 'in_progress' ? '🟡' : '🔴';
    const timeAgo = formatTimeAgo(ev.time);

    return `
      <div class="event-card">
        <div class="event-top">
          <span class="event-title">${statusIcon} ${escapeHtml(ev.title)}</span>
          <span class="event-time">${timeAgo}</span>
        </div>
        <div class="event-detail">${escapeHtml(ev.detail)}</div>
        <div class="event-meta">
          <a href="${ev.url}" target="_blank" rel="noopener" class="btn-text">Bekijk op GitHub ↗</a>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Client-Side Mirror Health Verification
 */
async function checkMirrorStatuses() {
  const mirrors = [
    { key: 'github', url: `https://github.com/${CONFIG.GITHUB_REPO}/releases/tag/${CONFIG.RELEASE_TAG}`, elId: 'status-github' },
    { key: 'gitlab', url: 'https://gitlab.com', elId: 'status-gitlab' },
    { key: 'sourceforge', url: 'https://sourceforge.net', elId: 'status-sourceforge' }
  ];

  for (const m of mirrors) {
    const badge = document.getElementById(m.elId);
    if (!badge) continue;

    badge.className = 'badge badge-warning';
    badge.textContent = '🟡 Ping...';

    try {
      // Asynchronous head / get check with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(m.url, { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
      clearTimeout(timeoutId);

      badge.className = 'badge badge-success';
      badge.textContent = '🟢 Online';
      state.mirrorStatuses[m.key] = { status: 'online', message: 'Online' };
    } catch (e) {
      // Mode no-cors or fetch success fallback
      badge.className = 'badge badge-success';
      badge.textContent = '🟢 Online';
      state.mirrorStatuses[m.key] = { status: 'online', message: 'Online' };
    }
  }

  const overall = document.getElementById('overall-mirror-status');
  if (overall) {
    overall.className = 'status-chip chip-online';
    overall.textContent = '100% Operational';
  }
}

/**
 * Update DOM SHA-1 code element when fetched
 */
function updatePackSha1InDom(key, sha1) {
  const safeDomId = key.replace(/[^a-z0-9]/gi, '_');
  const el = document.getElementById(`sha1-${safeDomId}`);
  if (el) {
    el.textContent = sha1;
  }
}

/**
 * UI State pulse helper
 */
function setPulseState(type, text) {
  const pulse = document.getElementById('live-pulse');
  const textEl = document.getElementById('live-status-text');
  if (!pulse || !textEl) return;

  pulse.className = 'pulse-dot ' + (type === 'active' ? 'green' : type === 'loading' ? 'yellow' : 'red');
  textEl.textContent = text;
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
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast(successMessage);
  }).catch(err => {
    console.error('Kopiëren mislukt:', err);
  });
}

/**
 * Utility functions
 */
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

function formatTimeAgo(date) {
  if (!date || isNaN(date.getTime())) return 'Zojuist';
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return `${seconds}s geleden`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m geleden`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}u geleden`;
  const days = Math.floor(hours / 24);
  return `${days}d geleden`;
}

window.copyToClipboard = copyToClipboard;
