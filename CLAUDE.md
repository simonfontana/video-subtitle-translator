# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A Chrome/Firefox WebExtension (Manifest V2) that integrates with YouTube and SVT Play to provide real-time subtitle translation using the DeepL API. No build system — files are loaded directly as an unpacked extension.

## Loading the Extension

1. Open Chrome → `chrome://extensions/` or Firefox → `about:debugging`
2. Enable Developer Mode
3. Click "Load unpacked" and select this directory

## Architecture

Three components communicate via `browser.runtime.sendMessage`:

**content.js** (injected into supported video pages) — handles all user interaction:
- Site-specific behaviour is configured in the `SITE_CONFIGS` object at the top of the file; add new sites there
- Listens for `click` and `dblclick` on subtitle segment elements (selector is per-site)
- Single click: extracts the clicked word using `document.caretPositionFromPoint()`, highlights it, requests translation
- Double click: extracts the full sentence across all visible caption segments, highlights it, requests translation
- Renders tooltip with translated text; each word in the translation is clickable for reverse translation (translated → source language)

**background.js** — translation service layer:
- Listens for `"translate"` messages from content.js
- Fetches DeepL API key and language settings from `browser.storage.local`
- POSTs to `https://api-free.deepl.com/v2/translate`; supports a `reverse` flag that swaps source/target languages

**popup.html + popup.js** — settings UI:
- User configures source/target language and DeepL API key
- Settings persisted to `browser.storage.local` (`sourceLang`, `targetLang`, `deeplApiKey`)
- Validates the API key with a test request to DeepL

## Key Behaviors

- A 250ms debounce on `click` is used to distinguish single-clicks from double-clicks
- Word boundaries are detected with a Unicode-aware regex `/\p{L}|\d|-/u`
- `highlightSentenceAcrossSegments()` maps sentence text positions across multiple DOM subtitle segments
- `cleanup()` is called on any click outside the tooltip to remove highlights and close the popup
- Video is paused when a translation is triggered
- `joinHyphenatedWord()` handles words split across subtitle lines (e.g. "komplett-" / "eringar" → "kompletteringar"). It returns both a joined form (for translation) and the original hyphenated form (for highlighting). The highlight code must walk multiple text nodes since the hyphenated word spans separate `<span>` elements — a single `Range` across nodes will throw `IndexSizeError`.

## Supported Sites

### YouTube (`www.youtube.com`)
- Subtitle selector: `.ytp-caption-segment`
- `suppressEvents: true` — YouTube's player swallows click events, so `mousedown`/`pointerdown` must be intercepted in capture phase

### SVT Play (`www.svtplay.se`)
- Subtitle selector: `.vtt-cue-teletext`
- Subtitle container: `div.video-player__text-tracks` (parent of the cue elements)
- `suppressEvents: true`
- Uses a standard `<video>` element — pause/play via the HTMLMediaElement API
- The page source fetched at page-load time does **not** contain subtitle elements; they are injected dynamically into the DOM only while the video is playing with subtitles enabled. To inspect subtitle DOM, run the video with subtitles on and query the live DOM (e.g. `document.querySelectorAll('[class*="cue"]')`).
- SVT Play is a Next.js app; CSS class names like `css-1okjmlg` are dynamically generated and unstable — always target semantic class names like `.vtt-cue-teletext` instead
- Each `.vtt-cue-teletext` element contains one `<span>` per subtitle line (e.g. `<span>komplett-</span><span>eringar ...</span>`). `caretPositionFromPoint` returns a text node inside one `<span>`, so the text boundary of a single word may not extend across line breaks. Use `captionElement.textContent` (which concatenates all inner spans) to reason about the full cue text.
- DOM node references captured at click time (via `caretPositionFromPoint`) may become stale by the time a deferred handler runs (e.g. after the 250ms debounce). Do not rely on node identity (`===`) for nodes captured before a timeout — compare by content or offset instead.

## Adding a New Site

1. Inspect the live subtitle DOM while a video is playing (page source will not show subtitle elements)
2. Find a stable, semantic CSS selector for the subtitle text element
3. Add an entry to `SITE_CONFIGS` in `content.js` with `subtitleSelector`, `suppressEvents`, and video control methods
4. Add the hostname pattern to `content_scripts[0].matches` in `manifest.json`
