let currentTranslationId = 0;
let lastTooltip = null;
let lastHighlightedElement = null;
let lastOriginalText = null;

// Main click handler
document.addEventListener("click", async (event) => {
    const clickedElement = event.target;
    const captionElement = clickedElement?.closest(".ytp-caption-segment");
    if (!captionElement) return;

    const translationId = ++currentTranslationId;

    // Extract clicked word from caret
    const caret = document.caretPositionFromPoint(event.clientX, event.clientY);
    if (!caret?.offsetNode?.textContent) return;

    const text = caret.offsetNode.textContent;
    let offset = caret.offset;
    let start = offset, end = offset;
    while (start > 0 && /\w|\p{L}/u.test(text[start - 1])) start--;
    while (end < text.length && /\w|\p{L}/u.test(text[end])) end++;

    let clickedWord = text.slice(start, end).trim().replace(/[.,!?;:]$/, '');
    if (!clickedWord) return;

    // Pause video and track when it resumes
    const video = document.querySelector("video");
    if (video) {
        video.pause();
        const onResume = () => {
            cleanup();
            video.removeEventListener("play", onResume);
        };
        video.addEventListener("play", onResume);
    }

    // Cleanup previous tooltip and highlight
    cleanup();

    // Save original
    const originalText = captionElement.innerText;
    const safeWord = clickedWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b(${safeWord})\\b`, "i");
    const highlightedText = originalText.replace(regex, `<span style="background: yellow; color: black;">$1</span>`);
    captionElement.innerHTML = highlightedText;

    lastHighlightedElement = captionElement;
    lastOriginalText = originalText;

    // Translate word
    const wordResult = await browser.runtime.sendMessage({ action: "translate", text: clickedWord });
    if (translationId !== currentTranslationId) return;

    // Show tooltip
    showTooltip({
        wordTranslation: wordResult.translation,
        x: event.clientX,
        y: event.clientY,
        sentenceText: captionElement.innerText,
        clickedWord,
        subtitleElement: captionElement,
        originalText,
        translationId
    });
});

// Cleanup tooltip + restore subtitle
function cleanup() {
    if (lastTooltip) {
        lastTooltip.remove();
        lastTooltip = null;
    }
    if (lastHighlightedElement && lastOriginalText) {
        lastHighlightedElement.innerText = lastOriginalText;
        lastHighlightedElement = null;
        lastOriginalText = null;
    }
}

// Show tooltip with button
function showTooltip({ wordTranslation, x, y, sentenceText, clickedWord, subtitleElement, originalText, translationId }) {
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

        const sentenceResult = await browser.runtime.sendMessage({
            action: "translate",
            text: sentenceText
        });

        if (translationId !== currentTranslationId) return; // Outdated — do nothing

        // Highlight full sentence with clicked word bold
        const safeWord = clickedWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`\\b(${safeWord})\\b`, "i");
        const bolded = sentenceText.replace(regex, `<strong>$1</strong>`);
        subtitleElement.innerHTML = `<span style="background: yellow; color: black;">${bolded}</span>`;

        tooltip.innerHTML = `<div style="font-size: 20px; line-height: 1.4;">${sentenceResult.translation}</div>`;
    });
}
