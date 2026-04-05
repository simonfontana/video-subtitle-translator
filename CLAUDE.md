# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A Chrome/Firefox WebExtension (Manifest V2) that integrates with YouTube and SVT Play to provide real-time subtitle translation using the DeepL API. No build system — files are loaded directly as an unpacked extension.

## Loading the Extension

1. Open Chrome → `chrome://extensions/` or Firefox → `about:debugging`
2. Enable Developer Mode
3. Click "Load unpacked" and select this directory

## Architecture

Four components communicate via `browser.runtime.sendMessage` (plus a shared utility module):

**utils.js** — pure functions shared between `background.js` and Node.js tests:
- `resolveLanguages(settings, reverse, detectedSourceLang)` — resolves source/target language pair for a DeepL request, handling auto-detect and reverse translation

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
- `cleanup()` is called when the video resumes to remove highlights and close the popup
- Video is paused when a translation is triggered
- `joinHyphenatedWord()` handles words split across subtitle lines (e.g. "komplett-" / "eringar" → "kompletteringar"). It returns both a joined form (for translation) and the original hyphenated form (for highlighting). The highlight code must walk multiple text nodes since the hyphenated word spans separate `<span>` elements — a single `Range` across nodes will throw `IndexSizeError`.

## Staleness & DOM Re-render Handling

Several mechanisms work together to handle the fact that pausing the video (or the 250ms click debounce) can cause the site to re-render subtitle elements, invalidating captured DOM references:

- **Caret captured immediately**: `caretInSubtitle()` is called synchronously at click time, before the 250ms timer, because the DOM may change before the deferred handler runs.
- **Global text offset**: `getGlobalTextOffset()` converts a (node, charStart) pair into a numeric position in the virtual concatenation of all segments' textContent. This survives DOM re-renders because it's a character position, not a node reference.
- **`waitForSubtitleSettle()`**: After pausing, waits for the subtitle container's MutationObserver to go quiet (50ms after last mutation, or 150ms timeout if no mutation at all).
- **Re-query after settle**: After the DOM settles, subtitle elements are re-queried from the DOM and `highlightWordAcrossSegments()` uses the saved global offset to find the correct word occurrence in the new nodes.
- **`currentTranslationId`**: Monotonically increasing counter that detects stale async responses. Each click bumps the ID; when a translation response arrives, it's discarded if the ID no longer matches.

## Highlighting Technique

Both `highlightWordAcrossSegments()` and `highlightSentenceAcrossSegments()` use the same DOM manipulation technique:
1. Clone all childNodes of the target segment (for later restoration via `restoreHighlights()`)
2. Walk text nodes with a `TreeWalker`
3. Use `splitText()` to isolate the character range that needs highlighting
4. Wrap the isolated text node in a `<span class="highlight-translate">`
5. Advance the walker to the remainder node after the split

This is necessary because a word/sentence can span multiple text nodes (e.g. in SVT Play where each subtitle line is a separate `<span>`). A single `Range` across nodes would throw `IndexSizeError`.

## Tooltip Interaction Flow

1. **Word view** (initial): Shows the translated word in bold. Right-click opens a custom context menu with "Copy" / "Copy original".
2. **Sentence view** (click the translated word): Translates the full sentence. Each word in the translated sentence is rendered as a clickable `<span>`.
3. **Reverse translation** (click a word in the sentence view): Shows a small popup above the word with its translation back to the source language (uses `reverse: true` in the message to background.js).

## content.css

- `content.css` is loaded alongside `content.js` by the manifest
- Defines `.highlight-translate` styles (yellow highlight for words/sentences)
- SVT Play subtitle elements have `pointer-events: none` set by the player's CSS — the `pointer-events: auto !important` override on `.vtt-cue-teletext` and its ancestors is required for `elementsFromPoint()` and click handlers to work
- Uses `div:has(.vtt-cue-teletext)` to target the subtitle container parent without relying on unstable generated class names

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

## Overlay Handling

`findSubtitleAt()` and `caretInSubtitle()` handle the common case where transparent overlay elements sit on top of subtitle text (YouTube's click-capture div, player control overlays, etc.):
- `findSubtitleAt()` uses `elementsFromPoint()` to look through the stacking order for a subtitle element
- `caretInSubtitle()` temporarily hides overlay elements (setting `visibility: hidden`) one by one until `caretPositionFromPoint()` can "see through" to the subtitle text node

## Known Issues / TODOs

### Features to consider
- **Translation caching**: Every click fires a DeepL request even for previously translated words. A simple in-memory `Map` cache in `background.js` (with a size cap) would reduce API usage and make repeat lookups instant.
- **Paid DeepL API support**: `api-free.deepl.com` is hardcoded in `background.js` and `popup.js`. Users with paid plans need `api.deepl.com`. Could auto-detect from key format (free keys end in `:fx`) or add a popup setting.
- **Error state leaves video paused**: If `handleClick` throws after pausing the video (e.g. extension context lost), the video stays paused with no tooltip and no way to dismiss. A `try/finally` ensuring cleanup on failure would help.

## Testing

Run tests with:

```
node --test test/*.test.js
```

## Adding a New Site

1. Inspect the live subtitle DOM while a video is playing (page source will not show subtitle elements)
2. Find a stable, semantic CSS selector for the subtitle text element
3. If the site uses a standard `<video>` element, call `makeVideoSiteConfig(selector)` and add the result to `SITE_CONFIGS` in `content.js`; otherwise write a custom config object with `subtitleSelector`, `suppressEvents`, and video control methods
4. Add the hostname pattern to `content_scripts[0].matches` in `manifest.json`
5. If the site's subtitle elements have `pointer-events: none`, add a CSS override in `content.css`
6. Test: single-click word translation, double-click sentence translation, hyphenated words, overlay handling
