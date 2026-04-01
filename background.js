function shouldActivateForUrl(url, data) {
  if (data.globalEnabled) return true;
  const urls = data.urlList || [];
  try {
    const origin = new URL(url).origin;
    return urls.includes(origin);
  } catch (_) {
    return false;
  }
}

async function activateTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "activate" });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
    } catch (_) { /* restricted page */ }
  }
  chrome.action.setBadgeText({ text: "ON", tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#7f5af0", tabId });
}

async function deactivateTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "deactivate" });
  } catch (_) { /* no content script */ }
  chrome.action.setBadgeText({ text: "", tabId });
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("about:")) return;

  const data = await chrome.storage.local.get(["globalEnabled", "urlList"]);
  if (shouldActivateForUrl(tab.url, data)) {
    activateTab(tabId);
  } else {
    chrome.action.setBadgeText({ text: "", tabId });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "setBadge") {
    const tabId = msg.tabId || sender.tab?.id;
    if (tabId) {
      chrome.action.setBadgeText({ text: msg.state ? "ON" : "", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#7f5af0", tabId });
    }
    sendResponse({ ok: true });
  }

  if (msg.action === "activateAllTabs") {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("about:")) {
          activateTab(tab.id);
        }
      }
    });
    sendResponse({ ok: true });
  }

  if (msg.action === "deactivateNonUrlTabs") {
    chrome.storage.local.get(["urlList"], (data) => {
      const urls = data.urlList || [];
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (!tab.url) continue;
          try {
            const origin = new URL(tab.url).origin;
            if (!urls.includes(origin)) {
              deactivateTab(tab.id);
            }
          } catch (_) {
            deactivateTab(tab.id);
          }
        }
      });
    });
    sendResponse({ ok: true });
  }

  return true;
});
