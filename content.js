(() => {
  "use strict";

  if (window.__privacyScreenLoaded) return;
  window.__privacyScreenLoaded = true;

  const XHTML_NS = "http://www.w3.org/1999/xhtml";
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "INPUT", "TEXTAREA", "SELECT", "CODE", "PRE",
  ]);
  const OBSERVED_ATTRIBUTES = ["class", "style", "hidden", "open", "aria-hidden"];
  const FOLLOW_UP_RESCAN_DELAYS_MS = [0, 150, 500, 1500];

  const LOWER = "abcdefghijklmnopqrstuvwxyz";
  const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const DIGITS = "0123456789";

  const originalTexts = new WeakMap();
  const scrambledTexts = new WeakMap();
  const rootObservers = new Map();
  let active = false;
  let mutationPaused = false;
  let currentHovered = null;
  let pendingMutations = [];
  let mutationTimer = null;
  let followUpRescanTimers = [];

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
    if (el.getAttribute) {
      const value = el.getAttribute("contenteditable");
      if (value && value !== "false") return true;
    }
    return false;
  }

  function shouldSkipElementSubtree(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.namespaceURI && el.namespaceURI !== XHTML_NS) return true;
    if (isEditableElement(el)) return true;
    return false;
  }

  function shouldSkipNode(node) {
    let current = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
    while (current) {
      if (current.nodeType === Node.ELEMENT_NODE && shouldSkipElementSubtree(current)) {
        return true;
      }
      current = getTraversalParent(current);
    }
    return false;
  }

  function isMeaningfulTextNode(textNode) {
    return !!(textNode && textNode.nodeType === Node.TEXT_NODE && textNode.textContent && textNode.textContent.trim());
  }

  function isInsideIframe() {
    try { return window.self !== window.top; } catch (_) { return true; }
  }

  function getTraversalParent(node) {
    if (!node) return null;
    if (node.parentNode) return node.parentNode;
    const root = node.getRootNode ? node.getRootNode() : null;
    return root && root.host ? root.host : null;
  }

  function isNodeWithinElement(node, element) {
    let current = node;
    while (current) {
      if (current === element) return true;
      current = getTraversalParent(current);
    }
    return false;
  }

  function withPausedMutations(fn) {
    mutationPaused = true;
    try {
      fn();
    } finally {
      mutationPaused = false;
    }
  }

  function setNodeText(textNode, text) {
    if (textNode.textContent === text) return;
    withPausedMutations(() => {
      textNode.textContent = text;
    });
  }

  function walkNode(node, callbacks) {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
      callbacks.onText?.(node);
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      if (shouldSkipElementSubtree(node)) return;
      callbacks.onElement?.(node);
      if (node.shadowRoot) {
        callbacks.onShadowRoot?.(node.shadowRoot);
        walkNode(node.shadowRoot, callbacks);
      }
    } else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && node.host) {
      callbacks.onShadowRoot?.(node);
    }

    for (let child = node.firstChild; child; child = child.nextSibling) {
      walkNode(child, callbacks);
    }
  }

  function getDocumentRoot() {
    return document.documentElement || document;
  }

  function collectTrackedTextNodes(root, limit = Number.POSITIVE_INFINITY) {
    const nodes = [];

    function visit(node) {
      if (!node || nodes.length >= limit) return false;

      if (node.nodeType === Node.TEXT_NODE) {
        if (originalTexts.has(node)) {
          nodes.push(node);
        }
        return nodes.length < limit;
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        if (shouldSkipElementSubtree(node)) return true;
        if (node.shadowRoot && visit(node.shadowRoot) === false) return false;
      }

      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (visit(child) === false) return false;
      }

      return true;
    }

    visit(root);
    return nodes;
  }

  function isInHoveredElement(textNode) {
    return !!(currentHovered && isNodeWithinElement(textNode, currentHovered));
  }

  function scrambleNode(textNode) {
    if (!isMeaningfulTextNode(textNode)) return;
    if (shouldSkipNode(textNode)) return;
    if (!originalTexts.has(textNode)) {
      originalTexts.set(textNode, textNode.textContent);
    }

    if (isInHoveredElement(textNode)) {
      setNodeText(textNode, originalTexts.get(textNode));
      return;
    }

    const scrambled = scrambleString(originalTexts.get(textNode));
    scrambledTexts.set(textNode, scrambled);
    setNodeText(textNode, scrambled);
  }

  function unscrambleNode(textNode) {
    if (originalTexts.has(textNode)) {
      setNodeText(textNode, originalTexts.get(textNode));
    }
  }

  function syncLiveTextNode(textNode) {
    if (!isMeaningfulTextNode(textNode)) return;
    if (shouldSkipNode(textNode)) return;

    if (!originalTexts.has(textNode)) {
      originalTexts.set(textNode, textNode.textContent);
      if (!isInHoveredElement(textNode)) {
        scrambleNode(textNode);
      }
      return;
    }

    const currentText = textNode.textContent;
    const original = originalTexts.get(textNode);
    const scrambled = scrambledTexts.get(textNode);

    if (currentText === scrambled) {
      return;
    }

    if (isInHoveredElement(textNode)) {
      if (currentText !== original) {
        originalTexts.set(textNode, currentText);
      }
      return;
    }

    if (currentText !== original) {
      originalTexts.set(textNode, currentText);
    }

    scrambleNode(textNode);
  }

  function rescanSubtree(root) {
    walkNode(root, {
      onText(textNode) {
        if (active) {
          syncLiveTextNode(textNode);
        }
      },
      onShadowRoot(shadowRoot) {
        observeRoot(shadowRoot);
      },
    });
  }

  function scrambleAll() {
    rescanSubtree(getDocumentRoot());
  }

  function unscrambleAll() {
    walkNode(getDocumentRoot(), {
      onText(textNode) {
        unscrambleNode(textNode);
      },
    });
  }

  function revealElement(element) {
    collectTrackedTextNodes(element).forEach(unscrambleNode);
  }

  function concealElement(element) {
    collectTrackedTextNodes(element).forEach(scrambleNode);
  }

  function findHoverTarget(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    for (const entry of path) {
      if (!(entry instanceof Element)) continue;
      if (shouldSkipElementSubtree(entry)) continue;
      if (collectTrackedTextNodes(entry, 1).length > 0) {
        return entry;
      }
    }
    return null;
  }

  function handleMouseOver(event) {
    if (!active) return;
    const target = findHoverTarget(event);
    if (target === currentHovered) return;

    if (currentHovered) {
      concealElement(currentHovered);
    }
    currentHovered = target;
    if (currentHovered) {
      revealElement(currentHovered);
    }
  }

  function handleMouseOut(event) {
    if (!active || !currentHovered) return;
    if (event.relatedTarget && isNodeWithinElement(event.relatedTarget, currentHovered)) return;
    concealElement(currentHovered);
    currentHovered = null;
  }

  function attachHoverListeners() {
    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("mouseout", handleMouseOut, true);
  }

  function detachHoverListeners() {
    document.removeEventListener("mouseover", handleMouseOver, true);
    document.removeEventListener("mouseout", handleMouseOut, true);
    currentHovered = null;
  }

  function observeRoot(root) {
    if (!root || rootObservers.has(root)) return;

    const observer = new MutationObserver((mutations) => {
      if (!active || mutationPaused) return;
      pendingMutations.push(...mutations);
      if (!mutationTimer) {
        mutationTimer = requestAnimationFrame(() => {
          mutationTimer = null;
          processMutationBatch();
        });
      }
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: OBSERVED_ATTRIBUTES,
    });

    rootObservers.set(root, observer);
  }

  function processMutationBatch() {
    if (!active) {
      pendingMutations = [];
      return;
    }

    const textNodesToProcess = new Set();
    const rootsToRescan = new Set();

    for (const mutation of pendingMutations) {
      if (mutation.type === "characterData" && mutation.target.nodeType === Node.TEXT_NODE) {
        textNodesToProcess.add(mutation.target);
        continue;
      }

      if (mutation.type === "attributes" && mutation.target.nodeType === Node.ELEMENT_NODE) {
        rootsToRescan.add(mutation.target);
        continue;
      }

      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          textNodesToProcess.add(node);
        } else if (
          node.nodeType === Node.ELEMENT_NODE ||
          node.nodeType === Node.DOCUMENT_FRAGMENT_NODE
        ) {
          rootsToRescan.add(node);
        }
      }
    }

    pendingMutations = [];

    rootsToRescan.forEach((root) => {
      rescanSubtree(root);
    });
    textNodesToProcess.forEach((textNode) => {
      syncLiveTextNode(textNode);
    });
  }

  function clearFollowUpRescans() {
    followUpRescanTimers.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    followUpRescanTimers = [];
  }

  function scheduleFollowUpRescans() {
    clearFollowUpRescans();
    FOLLOW_UP_RESCAN_DELAYS_MS.forEach((delay) => {
      const timerId = window.setTimeout(() => {
        if (active) {
          rescanSubtree(getDocumentRoot());
        }
      }, delay);
      followUpRescanTimers.push(timerId);
    });
  }

  function startObservers() {
    observeRoot(getDocumentRoot());
    walkNode(getDocumentRoot(), {
      onShadowRoot(shadowRoot) {
        observeRoot(shadowRoot);
      },
    });
  }

  function stopObservers() {
    rootObservers.forEach((observer) => {
      observer.disconnect();
    });
    rootObservers.clear();
    if (mutationTimer) {
      cancelAnimationFrame(mutationTimer);
      mutationTimer = null;
    }
    pendingMutations = [];
    clearFollowUpRescans();
  }

  function activate() {
    if (isInsideIframe()) return;
    if (active) return;
    active = true;
    attachHoverListeners();
    startObservers();
    scrambleAll();
    scheduleFollowUpRescans();
  }

  function deactivate() {
    if (!active) return;
    active = false;
    stopObservers();
    unscrambleAll();
    detachHoverListeners();
  }

  window.addEventListener("load", () => {
    if (active) {
      rescanSubtree(getDocumentRoot());
    }
  }, true);
  window.addEventListener("pageshow", () => {
    if (active) {
      rescanSubtree(getDocumentRoot());
    }
  }, true);

  activate();
  chrome.runtime.sendMessage({
    action: "setBadge",
    state: true,
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "activate") {
      activate();
      chrome.runtime.sendMessage({
        action: "setBadge",
        state: true,
      });
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
