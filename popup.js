const globalToggle = document.getElementById("globalToggle");
const urlToggle = document.getElementById("urlToggle");
const urlDisplay = document.getElementById("urlDisplay");

let currentOrigin = "";

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function originFromUrl(url) {
  try { return new URL(url).origin; } catch (_) { return ""; }
}

async function sendToTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return await chrome.tabs.sendMessage(tabId, msg);
  }
}

async function init() {
  const tab = await getCurrentTab();
  if (!tab?.id || !tab.url) return;

  currentOrigin = originFromUrl(tab.url);
  urlDisplay.innerHTML = currentOrigin
    ? `<span>${currentOrigin}</span>`
    : "Cannot detect site";

  const data = await chrome.storage.local.get(["globalEnabled", "urlList"]);
  const urls = data.urlList || [];

  globalToggle.checked = !!data.globalEnabled;
  urlToggle.checked = urls.includes(currentOrigin);
}

async function applyState(tab) {
  const data = await chrome.storage.local.get(["globalEnabled", "urlList"]);
  const urls = data.urlList || [];
  const shouldBeActive = !!data.globalEnabled || urls.includes(currentOrigin);

  await sendToTab(tab.id, {
    action: shouldBeActive ? "activate" : "deactivate",
  });

  chrome.runtime.sendMessage({
    action: "setBadge",
    tabId: tab.id,
    state: shouldBeActive,
  });
}

globalToggle.addEventListener("change", async () => {
  const tab = await getCurrentTab();
  if (!tab?.id) return;

  await chrome.storage.local.set({ globalEnabled: globalToggle.checked });

  if (globalToggle.checked) {
    chrome.runtime.sendMessage({ action: "activateAllTabs" });
  } else {
    chrome.runtime.sendMessage({ action: "deactivateNonUrlTabs" });
    await applyState(tab);
  }
});

urlToggle.addEventListener("change", async () => {
  const tab = await getCurrentTab();
  if (!tab?.id || !currentOrigin) return;

  const data = await chrome.storage.local.get(["urlList"]);
  let urls = data.urlList || [];

  if (urlToggle.checked) {
    if (!urls.includes(currentOrigin)) urls.push(currentOrigin);
  } else {
    urls = urls.filter((u) => u !== currentOrigin);
  }

  await chrome.storage.local.set({ urlList: urls });
  await applyState(tab);
});

init();
