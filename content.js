(() => {
  "use strict";

  if (window.__privacyScreenLoaded) return;
  window.__privacyScreenLoaded = true;

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "INPUT", "TEXTAREA", "SELECT", "CODE", "PRE",
  ]);

  const LOWER = "abcdefghijklmnopqrstuvwxyz";
  const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const DIGITS = "0123456789";

  const originalTexts = new WeakMap();
  let observer = null;
  let active = false;
  let mutationPaused = false;

  function scrambleChar(ch) {
    if (LOWER.includes(ch)) return LOWER[Math.floor(Math.random() * 26)];
    if (UPPER.includes(ch)) return UPPER[Math.floor(Math.random() * 26)];
    if (DIGITS.includes(ch)) return DIGITS[Math.floor(Math.random() * 10)];
    return ch;
  }

  function scrambleString(str) {
    let out = "";
    for (let i = 0; i < str.length; i++) out += scrambleChar(str[i]);
    return out;
  }

  function isEditableElement(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.getAttribute && el.getAttribute("role") === "textbox") return true;
    if (el.getAttribute && el.getAttribute("contenteditable") === "true") return true;
    return false;
  }

  function shouldSkipNode(node) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el) {
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el.namespaceURI && el.namespaceURI !== "http://www.w3.org/1999/xhtml") return true;
      if (isEditableElement(el)) return true;
      el = el.parentElement;
    }
    return false;
  }

  function isInsideIframe() {
    try { return window.self !== window.top; } catch (_) { return true; }
  }

  function getTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function scrambleNode(textNode) {
    if (!textNode.textContent.trim()) return;
    if (shouldSkipNode(textNode)) return;
    if (!originalTexts.has(textNode)) {
      originalTexts.set(textNode, textNode.textContent);
    }
    const scrambled = scrambleString(originalTexts.get(textNode));
    if (textNode.textContent !== scrambled) {
      mutationPaused = true;
      textNode.textContent = scrambled;
      mutationPaused = false;
    }
  }

  function unscrambleNode(textNode) {
    if (originalTexts.has(textNode)) {
      const original = originalTexts.get(textNode);
      if (textNode.textContent !== original) {
        mutationPaused = true;
        textNode.textContent = original;
        mutationPaused = false;
      }
    }
  }

  function scrambleAll() {
    getTextNodes(document.body).forEach(scrambleNode);
  }

  function unscrambleAll() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) unscrambleNode(walker.currentNode);
  }

  function getTextNodesInElement(el) {
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (originalTexts.has(walker.currentNode)) nodes.push(walker.currentNode);
    }
    return nodes;
  }

  function findHoverTarget(el) {
    while (el) {
      const hasDirectText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()
      );
      if (hasDirectText && originalTexts.has(
        Array.from(el.childNodes).find(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()
        )
      )) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  let currentHovered = null;

  function handleMouseOver(e) {
    if (!active) return;
    const target = findHoverTarget(e.target);
    if (target === currentHovered) return;

    if (currentHovered) {
      getTextNodesInElement(currentHovered).forEach(scrambleNode);
    }
    currentHovered = target;
    if (currentHovered) {
      getTextNodesInElement(currentHovered).forEach(unscrambleNode);
    }
  }

  function handleMouseOut(e) {
    if (!active || !currentHovered) return;
    if (e.relatedTarget && currentHovered.contains(e.relatedTarget)) return;
    getTextNodesInElement(currentHovered).forEach(scrambleNode);
    currentHovered = null;
  }

  function attachHoverListeners() {
    document.body.addEventListener("mouseover", handleMouseOver, true);
    document.body.addEventListener("mouseout", handleMouseOut, true);
  }

  function detachHoverListeners() {
    document.body.removeEventListener("mouseover", handleMouseOver, true);
    document.body.removeEventListener("mouseout", handleMouseOut, true);
    currentHovered = null;
  }

  let pendingMutations = [];
  let mutationTimer = null;

  function processMutationBatch() {
    if (!active) { pendingMutations = []; return; }

    const nodesToProcess = new Set();
    for (const mutation of pendingMutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          nodesToProcess.add(node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          if (SKIP_TAGS.has(node.tagName)) continue;
          if (isEditableElement(node)) continue;
          getTextNodes(node).forEach((tn) => nodesToProcess.add(tn));
        }
      }
      if (mutation.type === "characterData" && mutation.target.nodeType === Node.TEXT_NODE) {
        if (!originalTexts.has(mutation.target)) {
          nodesToProcess.add(mutation.target);
        }
      }
    }
    pendingMutations = [];
    nodesToProcess.forEach(scrambleNode);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      if (!active || mutationPaused) return;
      pendingMutations.push(...mutations);
      if (!mutationTimer) {
        mutationTimer = requestAnimationFrame(() => {
          mutationTimer = null;
          processMutationBatch();
        });
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (mutationTimer) {
      cancelAnimationFrame(mutationTimer);
      mutationTimer = null;
    }
    pendingMutations = [];
  }

  function activate() {
    if (isInsideIframe()) return;
    if (active) return;
    active = true;
    scrambleAll();
    attachHoverListeners();
    startObserver();
  }

  function deactivate() {
    if (!active) return;
    active = false;
    stopObserver();
    unscrambleAll();
    detachHoverListeners();
  }

  function getPageOrigin() {
    try { return new URL(window.location.href).origin; } catch (_) { return ""; }
  }

  function checkAndAutoActivate() {
    chrome.storage.local.get(["globalEnabled", "urlList"], (data) => {
      const origin = getPageOrigin();
      const urls = data.urlList || [];
      if (data.globalEnabled || urls.includes(origin)) {
        activate();
        chrome.runtime.sendMessage({
          action: "setBadge",
          state: true,
          reason: data.globalEnabled ? "global" : "url",
        });
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkAndAutoActivate);
  } else {
    checkAndAutoActivate();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "activate") {
      activate();
      sendResponse({ ok: true });
    } else if (msg.action === "deactivate") {
      deactivate();
      sendResponse({ ok: true });
    } else if (msg.action === "getState") {
      sendResponse({ active });
    }
    return true;
  });
})();
