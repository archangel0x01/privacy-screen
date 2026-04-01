const GLOBAL_SCRIPT_ID = "privacy-screen-global";
const SITE_SCRIPT_ID = "privacy-screen-sites";
const MANAGED_SCRIPT_IDS = [GLOBAL_SCRIPT_ID, SITE_SCRIPT_ID];
const BADGE_COLOR = "#7f5af0";
const RESTRICTED_URL_PREFIXES = [
  "chrome://",
  "about:",
  "edge://",
  "chrome-extension://",
  "moz-extension://",
];

function isRestrictedUrl(url) {
  return !url || RESTRICTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function getSettings() {
  const data = await chrome.storage.local.get(["globalEnabled", "urlList"]);
  return {
    globalEnabled: !!data.globalEnabled,
    urlList: Array.isArray(data.urlList) ? data.urlList : [],
  };
}

function shouldActivateForUrl(url, settings) {
  if (settings.globalEnabled) return true;
  try {
    const origin = new URL(url).origin;
    return settings.urlList.includes(origin);
  } catch (_) {
    return false;
  }
}

function originToMatchPattern(origin) {
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!url.hostname) return null;
    return `${url.protocol}//${url.hostname}/*`;
  } catch (_) {
    return null;
  }
}

async function syncRegisteredScripts() {
  const settings = await getSettings();
  const scripts = [];

  if (settings.globalEnabled) {
    scripts.push({
      id: GLOBAL_SCRIPT_ID,
      js: ["content.js"],
      matches: ["<all_urls>"],
      runAt: "document_start",
      persistAcrossSessions: true,
      allFrames: false,
    });
  } else {
    const matches = [...new Set(settings.urlList.map(originToMatchPattern).filter(Boolean))];
    if (matches.length > 0) {
      scripts.push({
        id: SITE_SCRIPT_ID,
        js: ["content.js"],
        matches,
        runAt: "document_start",
        persistAcrossSessions: true,
        allFrames: false,
      });
    }
  }

  try {
    await chrome.scripting.unregisterContentScripts({ ids: MANAGED_SCRIPT_IDS });
  } catch (_) { /* nothing registered yet */ }

  if (scripts.length > 0) {
    await chrome.scripting.registerContentScripts(scripts);
  }
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_) {
    return null;
  }
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function setBadge(tabId, isActive) {
  await chrome.action.setBadgeText({ text: isActive ? "ON" : "", tabId });
  if (isActive) {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR, tabId });
  }
}

async function activateTab(tabId) {
  let response = await sendToTab(tabId, { action: "activate" });
  if (!response) {
    const injected = await injectContentScript(tabId);
    if (injected) {
      response = await sendToTab(tabId, { action: "activate" });
    }
  }
  await setBadge(tabId, true);
}

async function deactivateTab(tabId) {
  await sendToTab(tabId, { action: "deactivate" });
  await setBadge(tabId, false);
}

async function applySettingsToTab(tab, settings) {
  if (!tab?.id) return;
  if (isRestrictedUrl(tab.url)) {
    await setBadge(tab.id, false);
    return;
  }

  if (shouldActivateForUrl(tab.url, settings)) {
    await activateTab(tab.id);
  } else {
    await deactivateTab(tab.id);
  }
}

async function applySettingsToAllTabs(settings = null) {
  const effectiveSettings = settings || await getSettings();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    await applySettingsToTab(tab, effectiveSettings);
  }
}

async function syncAndApplyEverywhere() {
  const settings = await getSettings();
  await syncRegisteredScripts();
  await applySettingsToAllTabs(settings);
}

chrome.runtime.onInstalled.addListener(() => {
  syncAndApplyEverywhere();
});

chrome.runtime.onStartup.addListener(() => {
  syncAndApplyEverywhere();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (!("globalEnabled" in changes) && !("urlList" in changes)) return;
  syncAndApplyEverywhere();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.url) return;

  if (changeInfo.status === "loading") {
    const settings = await getSettings();
    await setBadge(tabId, shouldActivateForUrl(tab.url, settings));
    return;
  }

  if (changeInfo.status === "complete") {
    const settings = await getSettings();
    await applySettingsToTab(tab, settings);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "setBadge") {
    const tabId = msg.tabId || sender.tab?.id;
    if (tabId) {
      setBadge(tabId, !!msg.state);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "syncSettings") {
    syncAndApplyEverywhere().then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  return true;
});
