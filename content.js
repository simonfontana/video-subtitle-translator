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

    console.log(`[DEBUG] Single click on word: "${clickedWord}"`);

    siteConfig.pauseVideo();
    siteConfig.onResume(() => cleanup());

    cleanup();

    highlightWordInSegment(captionElement, clickedWord);

    const wordResult = await browser.runtime.sendMessage({ action: "translate", text: clickedWord });
    if (translationId !== currentTranslationId) return;

    const sentenceText = getFullSentenceFromSubtitles(clickedWord, captionElement);
    showTooltip({
        wordTranslation: wordResult.translation,
        x: clientX,
        y: clientY,
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
        sentenceText,
        translationId
    });
}

function cleanup() {
    if (lastTooltip) { lastTooltip.remove(); lastTooltip = null; }
    for (const { el, originalHTML } of lastHighlightedSegments) {
        el.innerHTML = originalHTML;
    }
    lastHighlightedSegments = [];
}

function highlightWordInSegment(segment, clickedWord) {
    const originalHTML = segment.innerHTML;
    const safeWord = clickedWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wordRegex = new RegExp(`(^|\\s)(${safeWord})(?=\\s|$|[.,!?])`, "iu");
    // Apply highlight inside each child node to preserve existing DOM structure
    const targets = segment.children.length > 0 ? Array.from(segment.children) : [segment];
    let found = false;
    for (const node of targets) {
        if (found) break;
        const replaced = node.innerHTML.replace(wordRegex, (_match, prefix, word) => {
            found = true;
            return `${prefix}<span class="highlight-translate">${word}</span>`;
        });
        if (found) node.innerHTML = replaced;
    }
    lastHighlightedSegments = [{ el: segment, originalHTML }];
}

function showTooltip({ wordTranslation, x, y, sentenceText, translationId }) {
    const tooltip = document.createElement("div");
    tooltip.id = "subtitle-translate-tooltip";

    const subtitleElement = document.querySelector(SUBTITLE_SELECTOR);
    const subtitleRect = subtitleElement ? subtitleElement.getBoundingClientRect() : null;

    tooltip.innerHTML = `
        <div id="translatedWord" style="font-size: 22px; font-weight: bold; cursor: pointer;">
            ${wordTranslation}
        </div>
    `;

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

    translatedWordElement = tooltip.querySelector("#translatedWord");
    translatedWordElement.addEventListener("click", async () => {
        console.log(`[DEBUG] Translated word clicked. Full sentence: "${sentenceText}"`);
        tooltip.innerHTML = `<div style="font-size: 26px; line-height: 1.4;" id="translatedSentence"></div>`;
        const sentenceContainer = tooltip.querySelector("#translatedSentence");
        const sentenceResult = await browser.runtime.sendMessage({ action: "translate", text: sentenceText });
        if (translationId !== currentTranslationId) return;
        highlightSentenceAcrossSegments(sentenceText);

        const words = sentenceResult.translation.split(/\s+/);
        sentenceContainer.innerHTML = words.map(word =>
            `<span class="translated-word" style="cursor: pointer; position: relative; margin-right: 4px;">${word}</span>`
        ).join(' ');

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

function getFullSentenceFromSubtitles(clickedWord, clickedElement) {
    const segments = Array.from(document.querySelectorAll(SUBTITLE_SELECTOR));
    const text = segments.map(s => s.innerText.trim()).join(" ").replace(/\s+/g, " ");
    const sentenceRegex = /[^.!?]*[.!?]+["')\]]*|[^.!?]+$/g;
    const sentences = text.match(sentenceRegex) || [];
    const lowerClicked = clickedWord.toLowerCase();
    for (let sentence of sentences) {
        if (sentence.toLowerCase().includes(lowerClicked)) return sentence.trim();
    }
    return clickedElement.innerText.trim();
}

function highlightSentenceAcrossSegments(sentenceText) {
    const segments = Array.from(document.querySelectorAll(SUBTITLE_SELECTOR));
    let fullText = "";
    const segmentData = [];

    for (let el of segments) {
        const text = el.innerText;
        const start = fullText.length;
        fullText += (fullText ? " " : "") + text;
        const end = fullText.length;
        segmentData.push({ el, text, start, end, originalHTML: el.innerHTML });
    }

    const fullLowerText = fullText.toLowerCase();
    const lowerSentence = sentenceText.toLowerCase();
    const sentenceStart = fullLowerText.indexOf(lowerSentence);
    if (sentenceStart === -1) return;
    const sentenceEnd = sentenceStart + lowerSentence.length;

    lastHighlightedSegments = [];

    for (const { el, text, start, end, originalHTML } of segmentData) {
        const overlapStart = Math.max(start, sentenceStart);
        const overlapEnd = Math.min(end, sentenceEnd);
        if (overlapStart >= overlapEnd) continue;

        const segRelativeStart = overlapStart - start;
        const segRelativeEnd = overlapEnd - start;
        const matchText = text.slice(segRelativeStart, segRelativeEnd);

        // Highlight within each child node to preserve DOM structure
        const targets = el.children.length > 0 ? Array.from(el.children) : [el];
        let remaining = matchText.toLowerCase();
        for (const node of targets) {
            if (!remaining) break;
            const nodeText = node.textContent;
            const nodeLower = nodeText.toLowerCase();
            const idx = nodeLower.indexOf(remaining.slice(0, Math.min(remaining.length, nodeLower.length)));
            if (idx === -1) continue;
            const take = Math.min(remaining.length, nodeLower.length - idx);
            const before = nodeText.slice(0, idx);
            const match = nodeText.slice(idx, idx + take);
            const after = nodeText.slice(idx + take);
            node.innerHTML = `${before}<span class="highlight-translate">${match}</span>${after}`;
            remaining = remaining.slice(take);
        }

        lastHighlightedSegments.push({ el, originalHTML });
    }
}
