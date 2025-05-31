let currentTranslationId = 0;
let lastTooltip = null;
let lastHighlightedSegments = []; // Tracks { el, originalText }

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
    while (start > 0 && /\w|\p{L}/u.test(text[start - 1])) start--;
    while (end < text.length && /\w|\p{L}/u.test(text[end])) end++;

    let clickedWord = text.slice(start, end).trim().replace(/[.,!?;:]$/, '');
    if (!clickedWord) return;

    // Pause video + cleanup on resume
    const video = document.querySelector("video");
    if (video) {
        video.pause();
        const onResume = () => {
            cleanup();
            video.removeEventListener("play", onResume);
        };
        video.addEventListener("play", onResume);
    }

    cleanup(); // Clear previous highlights & tooltips

    // Highlight word in its segment
    const originalText = captionElement.innerText;
    const safeWord = clickedWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b(${safeWord})\\b`, "i");
    const highlightedText = originalText.replace(regex, `<span style="background: yellow; color: black;">$1</span>`);
    captionElement.innerHTML = highlightedText;
    lastHighlightedSegments = [{ el: captionElement, originalText }];

    // Translate word
    const wordResult = await browser.runtime.sendMessage({ action: "translate", text: clickedWord });
    if (translationId !== currentTranslationId) return;

    showTooltip({
        wordTranslation: wordResult.translation,
        x: event.clientX,
        y: event.clientY,
        sentenceText: getFullSentenceFromSubtitles(clickedWord, captionElement),
        clickedWord,
        translationId
    });
});

function cleanup() {
    if (lastTooltip) {
        lastTooltip.remove();
        lastTooltip = null;
    }
    for (const { el, originalText } of lastHighlightedSegments) {
        el.innerText = originalText;
    }
    lastHighlightedSegments = [];
}

function showTooltip({ wordTranslation, x, y, sentenceText, clickedWord, translationId }) {
    const tooltip = document.createElement("div");
    tooltip.id = "yt-translate-tooltip";
    tooltip.innerHTML = `
        <div style="font-size: 32px; font-weight: bold;">${wordTranslation}</div>
        <button id="translateSentenceBtn" style="
            margin-top: 10px;
            padding: 6px 10px;
            font-size: 14px;
            background: #444;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
        ">
            Translate full sentence
        </button>
    `;

    Object.assign(tooltip.style, {
        position: "fixed",
        top: `${y + 10}px`,
        left: `${x + 10}px`,
        background: "rgba(0, 0, 0, 0.85)",
        color: "#fff",
        padding: "14px 18px",
        borderRadius: "10px",
        fontSize: "18px",
        fontFamily: "Arial, sans-serif",
        zIndex: 9999,
        maxWidth: "600px",
        pointerEvents: "auto",
        boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
        opacity: "0",
        transition: "opacity 0.3s ease"
    });

    document.body.appendChild(tooltip);
    lastTooltip = tooltip;

    requestAnimationFrame(() => {
        tooltip.style.opacity = "1";
    });

    tooltip.querySelector("#translateSentenceBtn").addEventListener("click", async () => {
        tooltip.innerHTML = `<div style="font-size: 18px;">Translating sentence...</div>`;

        const sentenceResult = await browser.runtime.sendMessage({ action: "translate", text: sentenceText });
        if (translationId !== currentTranslationId) return;

        highlightSentenceAcrossSegments(clickedWord);
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

function highlightSentenceAcrossSegments(clickedWord) {
    const segments = Array.from(document.querySelectorAll('.ytp-caption-segment'));
    let fullText = "";
    const segmentData = [];

    for (let el of segments) {
        const text = el.innerText.trim();
        const start = fullText.length;
        fullText += (fullText.length > 0 ? " " : "") + text;
        const end = fullText.length;
        segmentData.push({ el, text, start, end });
    }

    const sentenceRegex = /[^.!?]*[.!?]+["')\]]*|[^.!?]+$/g;
    const sentences = fullText.match(sentenceRegex) || [];

    const lowerClicked = clickedWord.toLowerCase();
    let targetSentence = null;
    let sentenceStart = 0;

    for (let sentence of sentences) {
        if (sentence.toLowerCase().includes(lowerClicked)) {
            targetSentence = sentence.trim();
            break;
        }
        sentenceStart += sentence.length;
    }
    if (!targetSentence) return;

    const sentenceEnd = sentenceStart + targetSentence.length;

    lastHighlightedSegments = []; // Track all modified segments

    for (let { el, text, start, end } of segmentData) {
        const overlapStart = Math.max(start, sentenceStart);
        const overlapEnd = Math.min(end, sentenceEnd);
        if (overlapStart >= overlapEnd) continue;

        const segRelativeStart = overlapStart - start;
        const segRelativeEnd = overlapEnd - start;

        const safeBefore = text.slice(0, segRelativeStart)
            .replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const safeHighlight = text.slice(segRelativeStart, segRelativeEnd)
            .replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const safeAfter = text.slice(segRelativeEnd)
            .replace(/</g, "&lt;").replace(/>/g, "&gt;");

        lastHighlightedSegments.push({ el, originalText: el.innerText });
        el.innerHTML = `${safeBefore}<span style="background: yellow; color: black;">${safeHighlight}</span>${safeAfter}`;
    }
}
