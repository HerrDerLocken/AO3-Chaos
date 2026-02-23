// background.js — AO3 Chaos Extension

const STORAGE_KEY = 'ao3chaos_v1';

const AO3_URLS = [
  'archiveofourown.org',
  'transformativeworks.org',
];

function isAO3Tab(url) {
  if (!url) return false;
  return AO3_URLS.some(d => url.includes(d));
}

// Write data directly into a tab's localStorage — MV2 (Firefox) version.
function writeLocalStorageOnTab(tabId, data) {
  const code = `(function(){try{localStorage.setItem(${JSON.stringify(STORAGE_KEY)},${JSON.stringify(JSON.stringify(data))});}catch(e){}})();`;
  try {
    chrome.tabs.executeScript(tabId, { code }, () => {
      // ignore errors from tabs without content script access
      if (chrome.runtime.lastError) {}
    });
  } catch(e) {}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'SYNC_STORE') {
    // Content script syncing its localStorage → chrome.storage
    chrome.storage.local.set({ [STORAGE_KEY]: msg.data }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'GET_STORE') {
    chrome.storage.local.get(STORAGE_KEY, result => {
      sendResponse(result[STORAGE_KEY] || {});
    });
    return true;
  }

  if (msg.type === 'SET_STORE') {
    // Options page updating the store
    const data = msg.data;
    chrome.storage.local.set({ [STORAGE_KEY]: data }, () => {
      // Push to ALL open AO3 tabs via both executeScript (localStorage) and message
      chrome.tabs.query({}, tabs => {
        tabs.filter(t => isAO3Tab(t.url)).forEach(tab => {
          writeLocalStorageOnTab(tab.id, data);
          chrome.tabs.sendMessage(tab.id, { type: 'STORE_UPDATED', data }).catch?.(() => {});
        });
      });
      sendResponse({ ok: true });
    });
    return true;
  }
});
