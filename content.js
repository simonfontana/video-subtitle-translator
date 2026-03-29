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
if (!siteConfig) throw new Error(`[subtitle-translator] No config for ${window.location.hostname}`);
const SUBTITLE_SELECTOR = siteConfig.subtitleSelector;

let currentTranslationId = 0;
let lastTooltip = null;
let lastHighlightedSegments = [];
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

// Get caret position within a subtitle element, temporarily hiding any overlay elements on top
function caretInSubtitle(x, y, subtitleEl) {
    const direct = document.caretPositionFromPoint(x, y);
    if (direct?.offsetNode && subtitleEl.contains(direct.offsetNode)) return direct;
    // Hide each element above the subtitle in the stacking order
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

if (siteConfig.suppressEvents) {
    for (const eventType of ["mousedown", "pointerdown"]) {
        document.addEventListener(eventType, (event) => {
            if (findSubtitleAt(event)) {
                event.preventDefault();
                event.stopPropagation();
            }
        }, true); // capture phase so we beat the site's own handlers
    }
}

document.addEventListener("click", (event) => {
    const clickedElement = findSubtitleAt(event);
    if (!clickedElement) return;

    event.preventDefault();
    event.stopPropagation();

    // Capture caret position immediately — DOM may change before the 250ms timeout fires
    const caret = caretInSubtitle(event.clientX, event.clientY, clickedElement);

    if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
    }

    clickTimer = setTimeout(() => {
        handleClick(caret, event.clientX, event.clientY, clickedElement);
    }, 250); // 250ms delay to detect double-click
}, true);

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

async function handleClick(caret, clientX, clientY, captionElement) {
    const translationId = ++currentTranslationId;

    if (!caret?.offsetNode?.textContent) return;

    const text = caret.offsetNode.textContent;
    let offset = caret.offset;
    let start = offset, end = offset;
    while (start > 0 && (/\p{L}|\d|-/u.test(text[start - 1]))) start--;
    while (end < text.length && /\p{L}|\d/u.test(text[end])) end++;

    const clickedWord = text.slice(start, end).trim().replace(/[.,!?;:]/g, '');
    if (!clickedWord) return;

    // Calculate the clicked word's global offset across all subtitle segments before pause
    const globalOffset = getGlobalTextOffset(captionElement, caret.offsetNode, start);

    console.log(`[DEBUG] Single click on word: "${clickedWord}" at global offset ${globalOffset}`);

    siteConfig.pauseVideo();
    siteConfig.onResume(() => cleanup());

    cleanup();

    // Wait for the site to finish any subtitle re-render triggered by pause
    await waitForSubtitleSettle();

    // Re-query subtitle elements and highlight the correct occurrence
    const segments = Array.from(document.querySelectorAll(SUBTITLE_SELECTOR));
    const highlightResult = highlightWordAcrossSegments(segments, clickedWord, globalOffset);
    const currentElement = highlightResult?.element || captionElement;

    const wordResult = await browser.runtime.sendMessage({ action: "translate", text: clickedWord });
    if (translationId !== currentTranslationId) return;

    const sentenceText = getFullSentenceFromSubtitles(clickedWord, currentElement, segments, highlightResult?.wordOffset);
    showTooltip({
        wordTranslation: wordResult.translation,
        x: clientX,
        y: clientY,
        originalText: clickedWord,
        sentenceText,
        translationId
    });
}

async function handleDoubleClick(event, captionElement) {
    const translationId = ++currentTranslationId;
    const sentenceText = getFullSentenceFromSubtitles(captionElement.innerText.trim(), captionElement);
    console.log(`[DEBUG] Double-click detected. Full sentence: "${sentenceText}"`);

    siteConfig.pauseVideo();
    siteConfig.onResume(() => cleanup());

    cleanup();
    highlightSentenceAcrossSegments(sentenceText);

    const sentenceResult = await browser.runtime.sendMessage({ action: "translate", text: sentenceText });
    showTooltip({
        wordTranslation: sentenceResult.translation,
        x: event.clientX,
        y: event.clientY,
        originalText: sentenceText,
        sentenceText,
        translationId
    });
}

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

const SEGMENT_SEPARATOR_LENGTH = 1; // space between concatenated segments

function getSegmentOffsets(segments) {
    const offsets = [];
    let pos = 0;
    for (const seg of segments) {
        offsets.push(pos);
        pos += seg.textContent.length + SEGMENT_SEPARATOR_LENGTH;
    }
    return offsets;
}

function getGlobalTextOffset(clickedSegment, targetNode, charStart) {
    const segments = Array.from(document.querySelectorAll(SUBTITLE_SELECTOR));
    const segOffsets = getSegmentOffsets(segments);
    for (let i = 0; i < segments.length; i++) {
        if (segments[i] !== clickedSegment) continue;
        const walker = document.createTreeWalker(segments[i], NodeFilter.SHOW_TEXT);
        let nodeOffset = segOffsets[i];
        let node;
        while ((node = walker.nextNode())) {
            if (node === targetNode) return nodeOffset + charStart;
            nodeOffset += node.textContent.length;
        }
        return nodeOffset + charStart;
    }
    return 0;
}

function highlightWordAcrossSegments(segments, clickedWord, globalOffset) {
    const safeWord = clickedWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<![\\p{L}\\d])${safeWord}(?![\\p{L}\\d])`, "giu");
    const segOffsets = getSegmentOffsets(segments);

    // Collect all occurrences across all segments with global offsets
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

    // Pick the exact offset match, falling back to closest
    const best = matches.find(m => m.absOffset === globalOffset)
        || matches.reduce((a, b) =>
            Math.abs(a.absOffset - globalOffset) < Math.abs(b.absOffset - globalOffset) ? a : b
        );

    // Highlight using TreeWalker within the matched segment
    const seg = best.segment;
    const savedNodes = Array.from(seg.childNodes).map(n => n.cloneNode(true));
    const walker = document.createTreeWalker(seg, NodeFilter.SHOW_TEXT);
    let nodeOffset = 0;
    let node;
    while ((node = walker.nextNode())) {
        const nodeEnd = nodeOffset + node.textContent.length;
        if (best.index >= nodeOffset && best.index < nodeEnd) {
            const localIndex = best.index - nodeOffset;
            const range = document.createRange();
            range.setStart(node, localIndex);
            range.setEnd(node, localIndex + best.length);
            const highlight = document.createElement("span");
            highlight.className = "highlight-translate";
            range.surroundContents(highlight);
            break;
        }
        nodeOffset = nodeEnd;
    }

    lastHighlightedSegments = [{ el: seg, savedNodes }];
    return { element: seg, wordOffset: best.absOffset };
}

function showTooltip({ wordTranslation, x, y, originalText, sentenceText, translationId }) {
    let currentOriginal = originalText;
    const tooltip = document.createElement("div");
    tooltip.id = "subtitle-translate-tooltip";

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

    translatedWordElement = tooltip.querySelector("#translatedWord");
    translatedWordElement.addEventListener("click", async () => {
        currentOriginal = sentenceText;
        console.log(`[DEBUG] Translated word clicked. Full sentence: "${sentenceText}"`);
        tooltip.textContent = "";
        const sentenceDiv = document.createElement("div");
        sentenceDiv.id = "translatedSentence";
        Object.assign(sentenceDiv.style, { fontSize: "26px", lineHeight: "1.4" });
        tooltip.appendChild(sentenceDiv);
        const sentenceContainer = sentenceDiv;
        const sentenceResult = await browser.runtime.sendMessage({ action: "translate", text: sentenceText });
        if (translationId !== currentTranslationId) return;
        restoreHighlights();
        highlightSentenceAcrossSegments(sentenceText);

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

        // Reposition tooltip upward to account for new content height
        requestAnimationFrame(() => {
            const newRect = tooltip.getBoundingClientRect();
            if (subtitleRect) {
                tooltip.style.top = `${subtitleRect.top - newRect.height - 10}px`;
            }
        });

        sentenceContainer.querySelectorAll('.translated-word').forEach(span => {
            span.addEventListener('click', async () => {
                const clickedWord = span.textContent.trim().replace(/[.,!?;:]/g, '');
                console.log(`[DEBUG] Translating word back to source: "${clickedWord}"`);
                const reverseTranslation = await browser.runtime.sendMessage({ action: "translate", text: clickedWord, reverse: true });

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

function getFullSentenceFromSubtitles(clickedWord, clickedElement, segments, wordOffset) {
    if (!segments) segments = Array.from(document.querySelectorAll(SUBTITLE_SELECTOR));
    // Use raw textContent joined by spaces — same coordinate system as getSegmentOffsets/wordOffset
    const text = segments.map(s => s.textContent).join(" ");
    const sentenceRegex = /[^.!?]*[.!?]+["')\]]*|[^.!?]+$/g;

    // Use the exact word position to find the sentence containing it
    if (wordOffset !== undefined) {
        let match;
        while ((match = sentenceRegex.exec(text))) {
            if (wordOffset >= match.index && wordOffset < match.index + match[0].length) {
                return match[0].trim();
            }
        }
    }

    // Fallback: first sentence containing the word (used by double-click)
    sentenceRegex.lastIndex = 0;
    const lowerClicked = clickedWord.toLowerCase();
    const sentences = text.match(sentenceRegex) || [];
    for (let sentence of sentences) {
        if (sentence.toLowerCase().includes(lowerClicked)) return sentence.trim();
    }
    return clickedElement.textContent.trim();
}

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

        // Positions relative to the trimmed segment text
        const segRelativeStart = overlapStart - start;
        const segRelativeEnd = overlapEnd - start;

        // Adjust to raw text node positions by adding back leading whitespace
        const rawStart = segRelativeStart + leadingTrim;
        const rawEnd = segRelativeEnd + leadingTrim;

        // Walk text nodes and track cumulative offset within the segment
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

                // Split the text node and wrap the matching portion
                const before = node;
                const matchNode = before.splitText(localStart);
                const after = matchNode.splitText(localEnd - localStart);

                const highlight = document.createElement("span");
                highlight.className = "highlight-translate";
                matchNode.parentNode.replaceChild(highlight, matchNode);
                highlight.appendChild(matchNode);

                // Continue walking from the remainder node
                walker.currentNode = after;
                offset = hlEnd;
                continue;
            }
            offset = nodeEnd;
        }

        lastHighlightedSegments.push({ el, savedNodes });
    }
}
