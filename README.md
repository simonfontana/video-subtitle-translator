# Subtitle Translator

A browser extension that lets you click words in video subtitles to instantly translate them using the DeepL API. Works on YouTube and SVT Play.

## Features

- **Click a word** in the subtitles to translate it. The video pauses and a tooltip shows the translation.
- **Double-click** to translate the full sentence.
- **Click the translated word** in the tooltip to expand to a full sentence translation where each word is clickable.
- **Click any word in the sentence translation** to see its reverse translation (back to the source language).
- **Right-click the tooltip** to copy the translation or the original text.
- Handles hyphenated words split across subtitle lines (e.g. "komplett-" / "eringar" is joined into "kompletteringar" for translation).
- Supports 29 languages via the DeepL API, with auto-detect for the source language.

## Supported Sites

| Site | Subtitle selector |
|------|-------------------|
| YouTube | `.ytp-caption-segment` |
| SVT Play | `.vtt-cue-teletext` |

## Installation

### Prerequisites

You need a DeepL API key (free tier works). Get one at [deepl.com/your-account/keys](https://www.deepl.com/en/your-account/keys).

### Chrome

1. Go to `chrome://extensions/`
2. Enable **Developer Mode**
3. Click **Load unpacked** and select this directory

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` in this directory

### Configuration

1. Click the extension icon in the toolbar
2. Select your source and target languages
3. Enter your DeepL API key
4. Click **Save**

## Usage

1. Play a video with subtitles enabled
2. **Single-click** a word in the subtitles to translate it
3. **Double-click** the subtitles to translate the full sentence
4. Click the translated word in the tooltip to see the full sentence translation
5. Click any word in the sentence translation to see its reverse translation
6. The video resumes when you press play, and the tooltip is automatically dismissed

## Project Structure

```
manifest.json    - Extension manifest (Manifest V2)
content.js       - Injected into video pages; handles clicks, highlighting, tooltips
content.css      - Highlight styles and pointer-events overrides
background.js    - Receives translation requests, calls DeepL API
popup.html       - Settings UI (language selection, API key)
popup.js         - Settings persistence and API key validation
```

## AI Assistance

This project was written with the help of [Claude Code](https://claude.ai/code) (Anthropic).
I am a backend developer without JavaScript experience, so Claude was used to generate and iterate on the extension code throughout development.

## License

See [LICENSE](LICENSE).
