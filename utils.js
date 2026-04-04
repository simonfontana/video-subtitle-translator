// Shared pure utility functions used by background.js (and loaded via <script> in the extension).
// Can also be require()'d from Node.js tests.

// Resolve the source and target languages for a DeepL translation request.
// settings: { sourceLang, targetLang }
// reverse:  true for reverse translation (swap source/target)
// detectedSourceLang: detected_source_language from a prior forward translation,
//   used as target_lang when the configured source is "auto" and reverse is true.
//
// Returns { sourceLang, targetLang } where sourceLang may be null (omit from API call).
function resolveLanguages(settings, reverse, detectedSourceLang) {
    const sourceLang = reverse ? settings.targetLang : settings.sourceLang || "SV";
    // When sourceLang is "auto" and this is a reverse translation, targetLang would be
    // "auto" which DeepL rejects. Fall back to detectedSourceLang from the forward
    // translation, or "SV" as a last resort.
    const rawTargetLang = reverse ? settings.sourceLang : settings.targetLang || "EN";
    const targetLang = (rawTargetLang === "auto" || !rawTargetLang)
        ? (detectedSourceLang || "SV")
        : rawTargetLang;

    return {
        sourceLang: sourceLang === "auto" ? null : sourceLang,
        targetLang,
    };
}

// Join a hyphenated word split across subtitle lines within a caption element.
// e.g. <span>komplett-</span><span>eringar ...</span> → word: "kompletteringar", originalForm: "komplett-eringar"
// Uses captionElement.textContent (which concatenates all inner spans) as the source of truth.
// Returns { word, originalForm } — word is for translation, originalForm is for highlighting.
function joinHyphenatedWord(clickedWord, caretText, endOffset, captionElement) {
    const fullText = captionElement.textContent;
    const hyphenChars = '-\u2010\u2011';

    // Case 1: clicked word is followed by a hyphen in its text node
    if (endOffset < caretText.length && hyphenChars.includes(caretText[endOffset])) {
        // Find "clickedWord-<continuation>" in the full caption text
        const re = new RegExp(clickedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[' + hyphenChars + '](\\p{L}[\\p{L}\\d]*)', 'u');
        const m = fullText.match(re);
        if (m) return { word: clickedWord + m[1], originalForm: m[0] };
    }

    // Case 2: clicked the continuation — check if full text has "<prefix>-clickedWord"
    const re2 = new RegExp('([\\p{L}\\d]+)[' + hyphenChars + ']' + clickedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\d])', 'u');
    const m2 = fullText.match(re2);
    if (m2) return { word: m2[1] + clickedWord, originalForm: m2[0] };

    return { word: clickedWord, originalForm: null };
}

// Extract the word at a given offset within text.
// Walks backward (including hyphens, to catch the first half of hyphenated words)
// and forward (excluding hyphens — continuation is handled by joinHyphenatedWord).
// Returns { word, start, end } where start/end are character offsets into text,
// or null if no word characters are adjacent to the offset.
function extractWordAtOffset(text, offset) {
    let start = offset, end = offset;
    while (start > 0 && /\p{L}|\d|-/u.test(text[start - 1])) start--;
    while (end < text.length && /\p{L}|\d/u.test(text[end])) end++;

    const word = text.slice(start, end);
    if (!word) return null;

    return { word, start, end };
}

// Find the sentence within `text` that contains the clicked word.
// text:        pre-joined string from all subtitle segments (separated by " ")
// clickedWord: the word (or phrase) to locate
// wordOffset:  character offset of clickedWord in text — used to pick the right
//              sentence when the same word appears more than once. Omit to fall
//              back to a simple substring search.
// Returns the trimmed sentence string, or null if not found.
function getFullSentenceFromSubtitles(text, clickedWord, wordOffset) {
    const sentenceRegex = /[^.!?]*[.!?]+["')\]]*|[^.!?]+$/g;

    if (wordOffset !== undefined) {
        let match;
        while ((match = sentenceRegex.exec(text))) {
            if (wordOffset >= match.index && wordOffset < match.index + match[0].length) {
                return match[0].trim();
            }
        }
        sentenceRegex.lastIndex = 0;
    }

    const lowerClicked = clickedWord.toLowerCase();
    const sentences = text.match(sentenceRegex) || [];
    for (const sentence of sentences) {
        if (sentence.toLowerCase().includes(lowerClicked)) return sentence.trim();
    }
    return null;
}

if (typeof module !== "undefined") {
    module.exports = { resolveLanguages, joinHyphenatedWord, extractWordAtOffset, getFullSentenceFromSubtitles };
}
