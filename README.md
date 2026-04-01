# Privacy Screen

A Chrome/Firefox extension that scrambles all visible text on a page — hover over any element to reveal its content. Useful for screen sharing, recording demos, or working in public spaces.

![MV3](https://img.shields.io/badge/Manifest-V3-blue)
![Chrome](https://img.shields.io/badge/Chrome-Supported-brightgreen)
![Firefox](https://img.shields.io/badge/Firefox-Supported-orange)

## How it works

When activated, the extension traverses the DOM and replaces every text node with random characters of the same length, preserving spaces, punctuation, digits, and casing so the page layout stays identical. Moving your mouse over any element temporarily reveals the original text underneath.

A `MutationObserver` catches dynamically injected content (SPAs, infinite scroll, AJAX updates) and scrambles it on the fly.

### Demo

https://github.com/archangel0x01/privacy-screen/releases/download/v1.1.0/output.mp4

## Features

- **Two activation modes**
  - **All pages** — scrambles every page you visit until you turn it off
  - **This site only** — scrambles only a specific origin (e.g. `https://mail.google.com`), persists across tabs and sessions
- **Hover to reveal** — mouse over any text element to read it; move away and it re-scrambles
- **Persistent state** — settings survive browser restarts, new tabs auto-activate based on your config
- **Badge indicator** — "ON" badge on the extension icon when active
- **Layout-safe scrambling** — same character count, preserved whitespace and punctuation, no reflow
- **SPA-compatible** — `MutationObserver` handles dynamic content, virtual scrolling, and AJAX updates

## Skipped elements

The following are intentionally left unscrambled:

- `<script>`, `<style>`, `<noscript>`
- `<input>`, `<textarea>`, `<select>` (form fields)
- `<code>`, `<pre>` (code blocks)
- `contenteditable` elements and `role="textbox"` (rich text editors, compose windows)
- SVG text nodes and non-XHTML namespaces
- Content inside iframes

## Scramble algorithm

| Original | Scrambled to |
|---|---|
| Lowercase letter (a-z) | Random lowercase letter |
| Uppercase letter (A-Z) | Random uppercase letter |
| Digit (0-9) | Random digit |
| Everything else (spaces, punctuation, symbols) | Kept as-is |

## Installation

### Chrome

1. Clone this repo or download the ZIP
2. Go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `privacy-screen` folder

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select the `manifest.json` file from this folder

## File structure

```
privacy-screen/
  manifest.json     — MV3 extension manifest
  content.js        — DOM traversal, scrambling, hover reveal, MutationObserver
  popup.html        — Extension popup UI
  popup.js          — Popup logic (two toggles, state management)
  background.js     — Badge management, auto-activation on navigation
  icons/
    icon16.png
    icon48.png
    icon128.png
```

## Usage

1. Click the extension icon to open the popup
2. Toggle **All pages** to scramble every site, or **This site only** to scramble just the current origin
3. Hover over text to read it — move away and it scrambles again
4. Toggle off to fully restore all original text

Settings persist until you change them. Reloading a page, opening new tabs, or restarting the browser will re-apply your saved configuration.

## License

MIT
