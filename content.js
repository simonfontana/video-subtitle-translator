let currentTranslationId = 0;
let lastTooltip = null;
let lastHighlightedSegments = [];

document.addEventListener("click", async (event) => {
    const clickedElement = event.target;
    const captionElement = clickedElement?.closest(".ytp-caption-segment");
    if (!captionElement) return;

    const translationId = ++currentTranslationId;

    const caret = document.caretPositionFromPoint(event.clientX, event.clientY);
    if (!caret?.offsetNode?.textContent) return;

    const text = caret.offsetNode.textContent;
    let offset = caret.offset;
    let start = offset, end = offset;
    while (start > 0 && (/\p{L}|\d|-/u.test(text[start - 1]))) start--;
    while (end < text.length && /\p{L}|\d/u.test(text[end])) end++;

    const clickedWord = text.slice(start, end).trim().replace(/[.,!?;:]/g, '');
    if (!clickedWord) return;

    console.log(`[DEBUG] Clicked word: "${clickedWord}"`);

    const video = document.querySelector("video");
    if (video) {
        video.pause();
        const onResume = () => { cleanup(); video.removeEventListener("play", onResume); };
        video.addEventListener("play", onResume);
    }

    cleanup();

    highlightWordInSegment(captionElement, clickedWord);

    console.log(`[DEBUG] Sending translation request for word: "${clickedWord}"`);
    const wordResult = await browser.runtime.sendMessage({ action: "translate", text: clickedWord });
    if (translationId !== currentTranslationId) return;

    const sentenceText = getFullSentenceFromSubtitles(clickedWord, captionElement);
    console.log(`[DEBUG] Detected sentence for translation: "${sentenceText}"`);

    showTooltip({
        wordTranslation: wordResult.translation,
        x: event.clientX,
        y: event.clientY,
        sentenceText,
        clickedWord,
        translationId
    });
});

function cleanup() {
    if (lastTooltip) { lastTooltip.remove(); lastTooltip = null; }
    for (const { el, originalText } of lastHighlightedSegments) {
        el.innerText = originalText;
    }
    lastHighlightedSegments = [];
}

function highlightWordInSegment(segment, clickedWord) {
    const originalText = segment.innerText;
    const safeWord = clickedWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wordRegex = new RegExp(`(^|\\s)(${safeWord})(?=\\s|$|[.,!?])`, "iu");
    const highlightedHTML = originalText.replace(wordRegex, (match, prefix, word) => {
        return `${prefix}<span class="highlight-translate">${word}</span>`;
    });
    segment.innerHTML = highlightedHTML;
    lastHighlightedSegments = [{ el: segment, originalText }];
}

function showTooltip({ wordTranslation, x, y, sentenceText, clickedWord, translationId }) {
    const tooltip = document.createElement("div");
    tooltip.id = "yt-translate-tooltip";
    tooltip.innerHTML = `
        <div style="font-size: 32px; font-weight: bold;">${wordTranslation}</div>
        <button id="translateSentenceBtn" style="margin-top: 10px; padding: 6px 10px;">Translate full sentence</button>
    `;
    Object.assign(tooltip.style, {
        position: "fixed", top: `${y + 10}px`, left: `${x + 10}px`,
        background: "rgba(0, 0, 0, 0.85)", color: "#fff", padding: "10px",
        borderRadius: "8px", zIndex: 9999, maxWidth: "600px"
    });
    document.body.appendChild(tooltip); lastTooltip = tooltip;

    requestAnimationFrame(() => { tooltip.style.opacity = "1"; });

    tooltip.querySelector("#translateSentenceBtn").addEventListener("click", async () => {
        console.log(`[DEBUG] Sending translation request for full sentence: "${sentenceText}"`);
        tooltip.innerHTML = `<div style="font-size: 18px;">Translating sentence...</div>`;
        const sentenceResult = await browser.runtime.sendMessage({ action: "translate", text: sentenceText });
        if (translationId !== currentTranslationId) return;
        highlightSentenceAcrossSegments(sentenceText);
        tooltip.innerHTML = `<div style="font-size: 20px; line-height: 1.4;">${sentenceResult.translation}</div>`;
    });
}

function getFullSentenceFromSubtitles(clickedWord, clickedElement) {
    const segments = Array.from(document.querySelectorAll('.ytp-caption-segment'));
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
    const segments = Array.from(document.querySelectorAll('.ytp-caption-segment'));
    let fullText = "";
    const segmentData = [];

    for (let el of segments) {
        const text = el.innerText;
        const start = fullText.length;
        fullText += (fullText ? " " : "") + text;
        const end = fullText.length;
        segmentData.push({ el, text, start, end });
    }

    const fullLowerText = fullText.toLowerCase();
    const lowerSentence = sentenceText.toLowerCase();
    const sentenceStart = fullLowerText.indexOf(lowerSentence);
    if (sentenceStart === -1) return;
    const sentenceEnd = sentenceStart + lowerSentence.length;

    lastHighlightedSegments = [];

    for (const { el, text, start, end } of segmentData) {
        const overlapStart = Math.max(start, sentenceStart);
        const overlapEnd = Math.min(end, sentenceEnd);
        if (overlapStart >= overlapEnd) continue;

        const segRelativeStart = overlapStart - start;
        const segRelativeEnd = overlapEnd - start;

        const before = text.slice(0, segRelativeStart);
        const match = text.slice(segRelativeStart, segRelativeEnd);
        const after = text.slice(segRelativeEnd);

        el.innerHTML = `${before}<span class="highlight-translate">${match}</span>${after}`;
        lastHighlightedSegments.push({ el, originalText: text });
    }
}
