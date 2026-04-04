// TODO: YouTube and SVT Play configs are nearly identical (only selector differs).
// Consider extracting a shared base config to reduce duplication.
const SITE_CONFIGS = {
    "www.youtube.com": {
        subtitleSelector: ".ytp-caption-segment",
        suppressEvents: true, // suppress mousedown/pointerdown so we beat YouTube's handlers
        getVideoElement() {
            return document.querySelector("video");
        },
        pauseVideo() {
            const video = this.getVideoElement();
            if (video) video.pause();
        },
        resumeVideo() {
            const video = this.getVideoElement();
            if (video) video.play();
        },
        // Register a one-shot listener for when the video resumes playing.
        // Returns an unsubscribe function so the caller can cancel if needed.
        onResume(callback) {
            const video = this.getVideoElement();
            if (!video) return () => {};
            const handler = () => { callback(); video.removeEventListener("play", handler); };
            video.addEventListener("play", handler);
            return () => video.removeEventListener("play", handler);
        },
    },
    "www.svtplay.se": {
        subtitleSelector: ".vtt-cue-teletext",
        suppressEvents: true,
        getVideoElement() {
            return document.querySelector("video");
        },
        pauseVideo() {
            const video = this.getVideoElement();
            if (video) video.pause();
        },
        resumeVideo() {
            const video = this.getVideoElement();
            if (video) video.play();
        },
        onResume(callback) {
            const video = this.getVideoElement();
            if (!video) return () => {};
            const handler = () => { callback(); video.removeEventListener("play", handler); };
            video.addEventListener("play", handler);
            return () => video.removeEventListener("play", handler);
        },
    },
};

const siteConfig = SITE_CONFIGS[window.location.hostname];
if (!siteConfig) throw new Error(`[clicksub] No config for ${window.location.hostname}`);
const SUBTITLE_SELECTOR = siteConfig.subtitleSelector;

// Monotonically increasing ID used to discard stale translation responses.
// Each new click/dblclick bumps this; when the async response arrives, it's
// compared against currentTranslationId — if they differ, the result is outdated.
let currentTranslationId = 0;
let lastTooltip = null;
// Stores { el, savedNodes } for each segment that was modified by highlighting,
// so restoreHighlights() can put the original DOM back.
let lastHighlightedSegments = [];
// Timer for the 250ms single-click debounce (cleared on dblclick to prevent
// the single-click handler from also firing).
let clickTimer = null;

// Find subtitle element at click coordinates — needed when an overlay sits on top of subtitles
function findSubtitleAt(event) {
    const direct = event.target.closest(SUBTITLE_SELECTOR);
    if (direct) return direct;
    // Look through all elements stacked at this point (handles overlays)
    for (const el of document.elementsFromPoint(event.clientX, event.clientY)) {
        const match = el.closest(SUBTITLE_SELECTOR);
        if (match) return match;
    }
    return null;
}

// Wait for subtitle DOM to settle after an action (e.g. pause) that may trigger a site re-render.
// Resolves immediately if no mutation occurs within 150ms, or after the first mutation settles.
function waitForSubtitleSettle() {
    return new Promise(resolve => {
        const container = document.querySelector(SUBTITLE_SELECTOR)?.parentElement;
        if (!container) { resolve(); return; }
        let timer = setTimeout(done, 150);
        const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(done, 50);
        });
        observer.observe(container, { childList: true, subtree: true, characterData: true });
        function done() { observer.disconnect(); resolve(); }
    });
}

// Get caret position within a subtitle element, temporarily hiding any overlay elements on top.
// caretPositionFromPoint returns the text node + character offset at (x,y). If an overlay
// element (e.g. YouTube's transparent click-capture div) sits above the subtitle, the browser
// returns the overlay's node instead. We fix this by iterating elementsFromPoint (which returns
// elements top-to-bottom in stacking order), hiding each one until we reach the subtitle
// element, then re-querying caretPositionFromPoint so it "sees through" to the subtitle text.
function caretInSubtitle(x, y, subtitleEl) {
    const direct = document.caretPositionFromPoint(x, y);
    if (direct?.offsetNode && subtitleEl.contains(direct.offsetNode)) return direct;
    const hidden = [];
    for (const el of document.elementsFromPoint(x, y)) {
        if (el === subtitleEl || subtitleEl.contains(el)) break;
        el.style.visibility = "hidden";
        hidden.push(el);
    }
    const caret = document.caretPositionFromPoint(x, y);
    for (const el of hidden) el.style.visibility = "";
    return caret;
}

// Intercept mousedown/pointerdown in the capture phase on subtitle elements.
// YouTube (and SVT Play) attach their own handlers that would swallow the click
// before our "click" listener fires. By stopping propagation here, we ensure
// the subsequent "click" event reaches our handler below.
if (siteConfig.suppressEvents) {
    for (const eventType of ["mousedown", "pointerdown"]) {
        document.addEventListener(eventType, (event) => {
            if (findSubtitleAt(event)) {
                event.preventDefault();
                event.stopPropagation();
            }
        }, true);
    }
}

// Click-outside cleanup: dismiss tooltip, restore highlights, and resume video
// when the user clicks anywhere that isn't a subtitle element or the tooltip.
document.addEventListener("click", (event) => {
    if (!lastTooltip) return;
    const isTooltip = lastTooltip.contains(event.target);
    const isContextMenu = document.getElementById("subtitle-translate-context-menu")?.contains(event.target);
    const isSubtitle = !!event.target.closest(SUBTITLE_SELECTOR);
    if (!isTooltip && !isContextMenu && !isSubtitle) {
        cleanup();
        siteConfig.resumeVideo();
    }
}, true);

// Single-click on a subtitle word: translate just that word.
// We delay 250ms to distinguish from double-click. If a dblclick fires within
// that window, the timer is cleared and only the dblclick handler runs.
// The caret position is captured synchronously because the subtitle DOM may be
// mutated by the site before the 250ms timeout fires (e.g. subtitle line change).
document.addEventListener("click", (event) => {
    const clickedElement = findSubtitleAt(event);
    if (!clickedElement) return;

    event.preventDefault();
    event.stopPropagation();

    const caret = caretInSubtitle(event.clientX, event.clientY, clickedElement);

    if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
    }

    clickTimer = setTimeout(() => {
        handleClick(caret, event.clientX, event.clientY, clickedElement);
    }, 250);
}, true);

// Double-click on a subtitle: translate the full sentence.
// Cancels any pending single-click timer so only the sentence translation fires.
document.addEventListener("dblclick", (event) => {
    const clickedElement = findSubtitleAt(event);
    if (!clickedElement) return;

    event.preventDefault();
    event.stopPropagation();

    if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
    }

    handleDoubleClick(event, clickedElement);
}, true);

// Handle a single-click on a subtitle word:
// 1. Extract the clicked word from the caret position using Unicode-aware word boundaries
// 2. Join hyphenated words that are split across subtitle lines (e.g. "komplett-" + "eringar")
// 3. Compute global offset so we can re-find the word after the DOM re-renders on pause
// 4. Pause video, wait for subtitle DOM to settle, highlight the word, translate via DeepL
async function handleClick(caret, clientX, clientY, captionElement) {
    const translationId = ++currentTranslationId;

    if (!caret?.offsetNode?.textContent) return;

    const text = caret.offsetNode.textContent;
    let offset = caret.offset;

    const caretWord = extractWordAtOffset(text, offset);
    if (!caretWord) return;
    let { word: clickedWord, start, end } = caretWord;

    const hyphenResult = joinHyphenatedWord(clickedWord, text, end, captionElement);
    clickedWord = hyphenResult.word;
    // For highlighting: use the original hyphenated form (e.g. "komplett-eringar") so the
    // highlight spans match the actual DOM text; use the joined form for translation.
    const highlightWord = hyphenResult.originalForm || clickedWord;

    // Capture the word's absolute position across all visible segments *before* pausing,
    // because pausing may cause the site to re-render subtitles (new DOM nodes).
    const globalOffset = getGlobalTextOffset(captionElement, caret.offsetNode, start);

    siteConfig.pauseVideo();
    siteConfig.onResume(() => cleanup());

    cleanup();

    await waitForSubtitleSettle();

    // After pause + settle, subtitle DOM may be entirely new nodes. Re-query and use
    // the saved globalOffset to find and highlight the correct word occurrence.
    const segments = Array.from(document.querySelectorAll(SUBTITLE_SELECTOR));
    const highlightResult = highlightWordAcrossSegments(segments, highlightWord, globalOffset);
    const currentElement = highlightResult?.element || captionElement;

    const wordResult = await browser.runtime.sendMessage({ action: "translate", text: clickedWord });
    if (translationId !== currentTranslationId) return;

    // Determine the full sentence containing the clicked word (for sentence translation on
    // tooltip click). wordOffset helps disambiguate when the word appears multiple times.
    const joinedText = segments.map(s => s.textContent).join(" ");
    const sentenceText = getFullSentenceFromSubtitles(joinedText, clickedWord, highlightResult?.wordOffset)
        || currentElement.textContent.trim();
    showTooltip({
        wordTranslation: wordResult.translation,
        detectedSourceLang: wordResult.detectedSourceLang || null,
        x: clientX,
        y: clientY,
        originalText: clickedWord,
        sentenceText,
        translationId
    });
}

async function handleDoubleClick(event, captionElement) {
    const translationId = ++currentTranslationId;
    const allSegments = Array.from(document.querySelectorAll(SUBTITLE_SELECTOR));
    const joinedText = allSegments.map(s => s.textContent).join(" ");
    const captionText = captionElement.textContent.trim();
    // Pass captionText as the "word" — substring search works because captionText
    // is always a verbatim substring of joinedText.
    const sentenceText = getFullSentenceFromSubtitles(joinedText, captionText) || captionText;
    siteConfig.pauseVideo();
    siteConfig.onResume(() => cleanup());

    cleanup();
    highlightSentenceAcrossSegments(sentenceText);

    const sentenceResult = await browser.runtime.sendMessage({ action: "translate", text: sentenceText });
    showTooltip({
        wordTranslation: sentenceResult.translation,
        detectedSourceLang: sentenceResult.detectedSourceLang || null,
        x: event.clientX,
        y: event.clientY,
        originalText: sentenceText,
        sentenceText,
        translationId
    });
}

// Restore subtitle DOM nodes to their pre-highlight state by replacing the current
// (split + wrapped) children with the saved original childNode clones.
function restoreHighlights() {
    for (const { el, savedNodes } of lastHighlightedSegments) {
        el.textContent = "";
        for (const node of savedNodes) {
            el.appendChild(node);
        }
    }
    lastHighlightedSegments = [];
}

function cleanup() {
    if (lastTooltip) { lastTooltip.remove(); lastTooltip = null; }
    restoreHighlights();
}

// When segments are conceptually joined into one string (for sentence extraction,
// word-offset matching, etc.), we insert a 1-char separator (space) between them.
const SEGMENT_SEPARATOR_LENGTH = 1;

// Build an array of absolute character offsets — one per segment — representing where
// each segment's textContent starts in the virtual concatenated string.
// E.g. segments ["Hello", "world"] → offsets [0, 6] (5 chars + 1 separator).
function getSegmentOffsets(segments) {
    const offsets = [];
    let pos = 0;
    for (const seg of segments) {
        offsets.push(pos);
        pos += seg.textContent.length + SEGMENT_SEPARATOR_LENGTH;
    }
    return offsets;
}

// Compute the absolute character position of `charStart` within `targetNode` across
// all visible subtitle segments. This "global offset" survives DOM re-renders (where
// the actual node references become stale) because it's a numeric position in the
// concatenated text of all segments.
function getGlobalTextOffset(clickedSegment, targetNode, charStart) {
    const segments = Array.from(document.querySelectorAll(SUBTITLE_SELECTOR));
    const segOffsets = getSegmentOffsets(segments);
    for (let i = 0; i < segments.length; i++) {
        if (segments[i] !== clickedSegment) continue;
        // Walk text nodes within the matching segment to find the target node's
        // cumulative offset within the segment.
        const walker = document.createTreeWalker(segments[i], NodeFilter.SHOW_TEXT);
        let nodeOffset = segOffsets[i];
        let node;
        while ((node = walker.nextNode())) {
            if (node === targetNode) return nodeOffset + charStart;
            nodeOffset += node.textContent.length;
        }
        // Fallback: targetNode not found (shouldn't happen), use end of segment
        return nodeOffset + charStart;
    }
    return 0;
}

// Find and highlight a word across all subtitle segments, using globalOffset to
// disambiguate when the same word appears multiple times.
//
// Strategy:
// 1. Regex-match the word (with Unicode word-boundary lookarounds) across all segments
// 2. Pick the match whose absolute offset equals globalOffset, or the closest one
// 3. Walk the text nodes of that segment and wrap the overlapping character range
//    in <span class="highlight-translate">. This is done node-by-node because the
//    word may span multiple text nodes (e.g. hyphenated words in separate <span>s).
//
// The text-node splitting technique: splitText(pos) splits a text node in two at `pos`.
// We split twice to isolate the matching portion, then wrap it in a highlight <span>.
// After splitting, we advance the TreeWalker to the remainder node.
function highlightWordAcrossSegments(segments, clickedWord, globalOffset) {
    const safeWord = clickedWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Lookarounds ensure we match whole words only (no partial matches within longer words)
    const regex = new RegExp(`(?<![\\p{L}\\d])${safeWord}(?![\\p{L}\\d])`, "giu");
    const segOffsets = getSegmentOffsets(segments);

    const matches = [];
    for (let i = 0; i < segments.length; i++) {
        const text = segments[i].textContent;
        let m;
        regex.lastIndex = 0;
        while ((m = regex.exec(text))) {
            matches.push({ segment: segments[i], index: m.index, length: m[0].length, absOffset: segOffsets[i] + m.index });
        }
    }

    if (matches.length === 0) return null;

    const best = matches.find(m => m.absOffset === globalOffset)
        || matches.reduce((a, b) =>
            Math.abs(a.absOffset - globalOffset) < Math.abs(b.absOffset - globalOffset) ? a : b
        );

    const seg = best.segment;
    const savedNodes = Array.from(seg.childNodes).map(n => n.cloneNode(true));
    const hlStart = best.index;
    const hlEnd = best.index + best.length;
    const walker = document.createTreeWalker(seg, NodeFilter.SHOW_TEXT);
    let nodeOffset = 0;
    let node;
    while ((node = walker.nextNode())) {
        const nodeLen = node.textContent.length;
        const nodeStart = nodeOffset;
        const nodeEnd = nodeOffset + nodeLen;

        const overlapStart = Math.max(hlStart, nodeStart);
        const overlapEnd = Math.min(hlEnd, nodeEnd);

        if (overlapStart < overlapEnd) {
            const localStart = overlapStart - nodeStart;
            const localEnd = overlapEnd - nodeStart;

            // Split: [before | matchNode | after]
            const before = node;
            const matchNode = before.splitText(localStart);
            const after = matchNode.splitText(localEnd - localStart);

            const highlight = document.createElement("span");
            highlight.className = "highlight-translate";
            matchNode.parentNode.replaceChild(highlight, matchNode);
            highlight.appendChild(matchNode);

            walker.currentNode = after;
            nodeOffset = overlapEnd;
            if (overlapEnd >= hlEnd) break;
            continue;
        }
        nodeOffset = nodeEnd;
    }

    lastHighlightedSegments = [{ el: seg, savedNodes }];
    return { element: seg, wordOffset: best.absOffset };
}

// Build and display the translation tooltip.
// - Initially shows just the translated word (bold, 22px).
// - Clicking the translated word expands to the full sentence translation, where each
//   word is individually clickable for reverse translation (target→source language).
// - Right-clicking the tooltip shows a custom context menu with "Copy" / "Copy original".
// - `currentOriginal` tracks what "Copy original" should return: starts as the clicked
//   word, switches to sentenceText when the user expands to sentence view.
function showTooltip({ wordTranslation, detectedSourceLang, x, y, originalText, sentenceText, translationId }) {
    let currentOriginal = originalText;
    const tooltip = document.createElement("div");
    tooltip.id = "subtitle-translate-tooltip";

    // Position tooltip above the subtitle element (centered horizontally on it).
    // Falls back to click coordinates if no subtitle element is found.
    const subtitleElement = document.querySelector(SUBTITLE_SELECTOR);
    const subtitleRect = subtitleElement ? subtitleElement.getBoundingClientRect() : null;

    const translatedWordDiv = document.createElement("div");
    translatedWordDiv.id = "translatedWord";
    Object.assign(translatedWordDiv.style, { fontSize: "22px", fontWeight: "bold", cursor: "pointer" });
    translatedWordDiv.textContent = wordTranslation;
    tooltip.appendChild(translatedWordDiv);

    Object.assign(tooltip.style, {
        position: "fixed",
        background: "rgba(0, 0, 0, 0.85)",
        color: "#fff",
        padding: "10px",
        borderRadius: "8px",
        zIndex: 9999,
        maxWidth: "600px",
        transform: "translateX(-50%)",
        textAlign: "center",
        fontFamily: "'YouTube Noto', Roboto, Arial, Helvetica, sans-serif",
        opacity: "0",
    });

    document.body.appendChild(tooltip);
    lastTooltip = tooltip;

    // Position in a rAF callback so the browser has laid out the tooltip and we can
    // read its dimensions. Starts with opacity:0 to avoid a flash at the wrong position.
    requestAnimationFrame(() => {
        const tooltipRect = tooltip.getBoundingClientRect();
        let tooltipTop = y + 10;
        let tooltipLeft = x + 10;
        if (subtitleRect) {
            tooltipTop = subtitleRect.top - tooltipRect.height - 10;
            tooltipLeft = subtitleRect.left + subtitleRect.width / 2;
        }
        tooltip.style.top = `${tooltipTop}px`;
        tooltip.style.left = `${tooltipLeft}px`;
        tooltip.style.opacity = "1";
    });

    // Custom right-click context menu on the tooltip (replaces the browser default).
    // Offers "Copy" (the translation text) and "Copy original" (the source text).
    tooltip.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const existing = document.getElementById("subtitle-translate-context-menu");
        if (existing) existing.remove();

        const menu = document.createElement("div");
        menu.id = "subtitle-translate-context-menu";
        Object.assign(menu.style, {
            position: "fixed",
            background: "rgba(30, 30, 30, 0.97)",
            color: "#fff",
            borderRadius: "6px",
            padding: "4px 0",
            zIndex: 10001,
            minWidth: "120px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
            fontFamily: "'YouTube Noto', Roboto, Arial, Helvetica, sans-serif",
            fontSize: "14px",
        });
        // Initially off-screen; repositioned in rAF once dimensions are known
        menu.style.top = "-9999px";
        menu.style.left = "-9999px";

        const dismissMenu = () => {
            menu.remove();
            document.removeEventListener("click", onClickOutside, true);
        };
        const onClickOutside = (e) => {
            if (!menu.contains(e.target)) dismissMenu();
        };

        const copyItem = document.createElement("div");
        copyItem.textContent = "Copy";
        Object.assign(copyItem.style, {
            padding: "6px 16px",
            cursor: "pointer",
        });
        copyItem.addEventListener("mouseenter", () => { copyItem.style.background = "rgba(255,255,255,0.15)"; });
        copyItem.addEventListener("mouseleave", () => { copyItem.style.background = ""; });
        copyItem.addEventListener("click", () => {
            navigator.clipboard.writeText(tooltip.textContent);
            dismissMenu();
        });

        const copyOriginalItem = document.createElement("div");
        copyOriginalItem.textContent = "Copy original";
        Object.assign(copyOriginalItem.style, {
            padding: "6px 16px",
            cursor: "pointer",
        });
        copyOriginalItem.addEventListener("mouseenter", () => { copyOriginalItem.style.background = "rgba(255,255,255,0.15)"; });
        copyOriginalItem.addEventListener("mouseleave", () => { copyOriginalItem.style.background = ""; });
        copyOriginalItem.addEventListener("click", () => {
            navigator.clipboard.writeText(currentOriginal);
            dismissMenu();
        });

        menu.appendChild(copyItem);
        menu.appendChild(copyOriginalItem);
        document.body.appendChild(menu);

        requestAnimationFrame(() => {
            menu.style.top = `${event.clientY - menu.offsetHeight}px`;
            menu.style.left = `${event.clientX}px`;
        });

        document.addEventListener("click", onClickOutside, true);
    });

    // Clicking the translated word in the tooltip expands to the full sentence translation.
    // The sentence highlight replaces the word highlight in the subtitle DOM.
    const translatedWordElement = tooltip.querySelector("#translatedWord");
    translatedWordElement.addEventListener("click", async () => {
        currentOriginal = sentenceText;
        tooltip.textContent = "";
        const sentenceDiv = document.createElement("div");
        sentenceDiv.id = "translatedSentence";
        Object.assign(sentenceDiv.style, { fontSize: "26px", lineHeight: "1.4" });
        tooltip.appendChild(sentenceDiv);
        const sentenceContainer = sentenceDiv;
        const sentenceResult = await browser.runtime.sendMessage({ action: "translate", text: sentenceText });
        if (translationId !== currentTranslationId) return;
        if (sentenceResult.detectedSourceLang) detectedSourceLang = sentenceResult.detectedSourceLang;
        restoreHighlights();
        highlightSentenceAcrossSegments(sentenceText);

        // Render each translated word as a clickable span for reverse-translation lookup
        const words = sentenceResult.translation.split(/\s+/);
        sentenceContainer.textContent = "";
        words.forEach((word, i) => {
            if (i > 0) sentenceContainer.appendChild(document.createTextNode(" "));
            const span = document.createElement("span");
            span.className = "translated-word";
            Object.assign(span.style, { cursor: "pointer", position: "relative", marginRight: "4px" });
            span.textContent = word;
            sentenceContainer.appendChild(span);
        });

        // Reposition tooltip upward since sentence text is taller than a single word
        requestAnimationFrame(() => {
            const newRect = tooltip.getBoundingClientRect();
            if (subtitleRect) {
                tooltip.style.top = `${subtitleRect.top - newRect.height - 10}px`;
            }
        });

        // Reverse translation: clicking a word in the translated sentence shows a small
        // popup above it with the word translated back to the source language.
        sentenceContainer.querySelectorAll('.translated-word').forEach(span => {
            span.addEventListener('click', async () => {
                const clickedWord = span.textContent.trim().replace(/[.,!?;:]/g, '');
                const reverseTranslation = await browser.runtime.sendMessage({ action: "translate", text: clickedWord, reverse: true, detectedSourceLang });

                // Reuse existing popup if the same word is clicked again
                let popup = span.querySelector('.reverse-translation');
                if (!popup) {
                    popup = document.createElement('div');
                    popup.className = 'reverse-translation';
                    Object.assign(popup.style, {
                        position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                        background: 'rgba(0, 0, 0, 0.85)', color: '#fff', padding: '2px 6px',
                        borderRadius: '4px', whiteSpace: 'nowrap', fontSize: 'smaller', marginBottom: '4px',
                        zIndex: 10000
                    });
                    span.appendChild(popup);
                }
                popup.textContent = reverseTranslation.translation;
            });
        });
    });
}


// Highlight an entire sentence across multiple subtitle segments (used for double-click
// and the expanded sentence view in the tooltip).
//
// The challenge: a sentence may span multiple subtitle segment elements (e.g. two
// .ytp-caption-segment divs or two .vtt-cue-teletext spans). We need to:
// 1. Build a virtual concatenated string from all segments (trimmed, space-separated)
// 2. Find the sentence's position in this virtual string (case-insensitive indexOf)
// 3. For each segment that overlaps the sentence range, walk its text nodes and wrap
//    the overlapping characters in highlight <span>s
//
// `leadingTrim` compensates for the fact that we trim segment text for matching but
// need raw character positions when splitting DOM text nodes.
function highlightSentenceAcrossSegments(sentenceText) {
    const segments = Array.from(document.querySelectorAll(SUBTITLE_SELECTOR));
    let fullText = "";
    const segmentData = [];

    for (let el of segments) {
        const rawText = el.textContent;
        const trimmed = rawText.trim();
        const leadingTrim = rawText.length - rawText.trimStart().length;
        const start = fullText.length;
        fullText += (fullText ? " " : "") + trimmed;
        const end = fullText.length;
        segmentData.push({ el, start, end, savedNodes: Array.from(el.childNodes).map(n => n.cloneNode(true)), leadingTrim });
    }

    const fullLowerText = fullText.toLowerCase();
    const lowerSentence = sentenceText.trim().toLowerCase();
    const sentenceStart = fullLowerText.indexOf(lowerSentence);
    if (sentenceStart === -1) return;
    const sentenceEnd = sentenceStart + lowerSentence.length;

    lastHighlightedSegments = [];

    for (const { el, start, end, savedNodes, leadingTrim } of segmentData) {
        const overlapStart = Math.max(start, sentenceStart);
        const overlapEnd = Math.min(end, sentenceEnd);
        if (overlapStart >= overlapEnd) continue;

        // Convert from virtual-string coordinates to segment-local coordinates
        const segRelativeStart = overlapStart - start;
        const segRelativeEnd = overlapEnd - start;

        // Shift back to raw text node positions (undo the trim we did for matching)
        const rawStart = segRelativeStart + leadingTrim;
        const rawEnd = segRelativeEnd + leadingTrim;

        // Same text-node-walking + splitText technique as highlightWordAcrossSegments
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let offset = 0;
        let node;
        while ((node = walker.nextNode())) {
            const nodeLen = node.textContent.length;
            const nodeStart = offset;
            const nodeEnd = offset + nodeLen;

            const hlStart = Math.max(rawStart, nodeStart);
            const hlEnd = Math.min(rawEnd, nodeEnd);

            if (hlStart < hlEnd) {
                const localStart = hlStart - nodeStart;
                const localEnd = hlEnd - nodeStart;

                const before = node;
                const matchNode = before.splitText(localStart);
                const after = matchNode.splitText(localEnd - localStart);

                const highlight = document.createElement("span");
                highlight.className = "highlight-translate";
                matchNode.parentNode.replaceChild(highlight, matchNode);
                highlight.appendChild(matchNode);

                walker.currentNode = after;
                offset = hlEnd;
                continue;
            }
            offset = nodeEnd;
        }

        lastHighlightedSegments.push({ el, savedNodes });
    }
}
