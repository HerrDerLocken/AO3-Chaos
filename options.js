// options.js — AO3 Chaos Extension Settings

const STORAGE_KEY = 'ao3chaos_v1';
const AO3_ORIGIN = 'https://archiveofourown.org';

function getStore() {
  // Options page reads from chrome.storage.local via messaging
  // (since localStorage is per-origin and the extension options page
  // is on extension:// origin, we use chrome.storage.local as bridge)
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(STORAGE_KEY, result => {
        resolve(result[STORAGE_KEY] || {});
      });
    } catch(e) {
      // Firefox fallback / direct access
      try {
        resolve(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
      } catch(e2) { resolve({}); }
    }
  });
}

// Since the content script uses AO3's localStorage, we inject a bridge via
// chrome.scripting to read/write. Simpler: we message the content script.
// ACTUALLY simplest: we store in chrome.storage.local from content.js too.
// For now, read from chrome.storage.local (content.js syncs both).

// Read from content script's localStorage via background message
function getAO3Store() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_STORE' }, response => {
      resolve(response || {});
    });
  });
}

function setAO3Store(data) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'SET_STORE', data }, response => {
      resolve(response);
    });
  });
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

async function render() {
  const store = await getAO3Store();
  const tier = store.tier || 'free';
  const tierDescs = {
    free:    'All tags hidden. 5 fics/day limit. Escalation starts after 2 min.',
    plus:    'Relationships hidden only. 20 fics/day. Slow escalation. ($6.9/mo)',
    premium: 'All tags visible. Unlimited reading. Zero chaos escalation. ($42.0/mo)',
  };
  const tierIcons = { free: '🆓 FREE', plus: '🔵 PLUS', premium: '⭐ PREMIUM' };

  const badge = document.getElementById('tier-badge');
  const desc  = document.getElementById('tier-desc');
  if (badge) {
    badge.className = 'status-badge status-' + tier;
    badge.textContent = tierIcons[tier];
  }
  if (desc) desc.textContent = tierDescs[tier];

  // Reading stats
  const today = new Date().toDateString();
  const reads  = store.reads || {};
  const limits = { free: 5, plus: 20, premium: '∞' };
  document.getElementById('reads-today').textContent = `${reads[today] || 0} / ${limits[tier]}`;
  document.getElementById('reads-limit').textContent = tier === 'premium' ? 'Unlimited ✓' : limits[tier] + ' fics';

  // Trophies
  const trophies = store.trophies || {};
  const entries  = Object.entries(trophies);
  const list = document.getElementById('trophies-list');
  const countDesc = document.getElementById('trophy-count-desc');
  if (countDesc) countDesc.textContent = `Works you've awarded a trophy to: ${entries.length}`;
  if (list) {
    list.innerHTML = '';
    if (entries.length === 0) {
      list.innerHTML = '<li><span class="empty-note">No trophies given yet!</span></li>';
    } else {
      entries.forEach(([id, data]) => {
        const li = document.createElement('li');
        li.innerHTML = `<a href="https://archiveofourown.org/works/${id}" target="_blank">🏆 ${data.title}</a><span class="trophy-date">${new Date(data.date).toLocaleDateString()}</span>`;
        list.appendChild(li);
      });
    }
  }
}

// Button handlers
document.getElementById('btn-reset-tier').addEventListener('click', async () => {
  const store = await getAO3Store();
  delete store.tier;
  delete store.ageVerified;
  await setAO3Store(store);
  render();
  showToast('✓ Tier reset to Free');
});

document.getElementById('btn-reset-reads').addEventListener('click', async () => {
  const store = await getAO3Store();
  store.reads = {};
  await setAO3Store(store);
  render();
  showToast('✓ Reading count reset');
});

document.getElementById('btn-clear-trophies').addEventListener('click', async () => {
  const store = await getAO3Store();
  store.trophies = {};
  await setAO3Store(store);
  render();
  showToast('✓ All trophies cleared');
});

document.getElementById('btn-nuclear').addEventListener('click', async () => {
  if (!confirm('Reset absolutely everything? This cannot be undone.')) return;
  await setAO3Store({});
  render();
  showToast('☢️ Everything reset. Fresh chaos awaits.');
});

// Init
render();
