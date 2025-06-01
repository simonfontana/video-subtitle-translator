let currentTranslationId = 0;
let lastTooltip = null;
let lastHighlightedSegments = [];
let clickTimer = null;

document.addEventListener("click", (event) => {
    const clickedElement = event.target.closest(".ytp-caption-segment");
    if (!clickedElement) return;

    if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
    }

    clickTimer = setTimeout(() => {
        handleClick(event, clickedElement);
    }, 250); // 250ms delay to detect double-click
});

document.addEventListener("dblclick", (event) => {
    const clickedElement = event.target.closest(".ytp-caption-segment");
    if (!clickedElement) return;

    if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
    }

    handleDoubleClick(event, clickedElement);
});

async function handleClick(event, captionElement) {
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

    console.log(`[DEBUG] Single click on word: "${clickedWord}"`);

    const video = document.querySelector("video");
    if (video) {
        video.pause();
        const onResume = () => { cleanup(); video.removeEventListener("play", onResume); };
        video.addEventListener("play", onResume);
    }

    cleanup();

    highlightWordInSegment(captionElement, clickedWord);

    const wordResult = await browser.runtime.sendMessage({ action: "translate", text: clickedWord });
    if (translationId !== currentTranslationId) return;

    const sentenceText = getFullSentenceFromSubtitles(clickedWord, captionElement);
    showTooltip({
        wordTranslation: wordResult.translation,
        x: event.clientX,
        y: event.clientY,
        sentenceText,
        clickedWord,
        translationId
    });
}

async function handleDoubleClick(event, captionElement) {
    const translationId = ++currentTranslationId;
    const sentenceText = getFullSentenceFromSubtitles(captionElement.innerText.trim(), captionElement);
    console.log(`[DEBUG] Double-click detected. Full sentence: "${sentenceText}"`);

    const video = document.querySelector("video");
    if (video) {
        video.pause();
        const onResume = () => { cleanup(); video.removeEventListener("play", onResume); };
        video.addEventListener("play", onResume);
    }

    cleanup();
    highlightSentenceAcrossSegments(sentenceText);

    const sentenceResult = await browser.runtime.sendMessage({ action: "translate", text: sentenceText });
    showTooltip({
        wordTranslation: sentenceResult.translation,
        x: event.clientX,
        y: event.clientY,
        sentenceText,
        clickedWord: sentenceText,
        translationId
    });
}

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

    const subtitleElement = document.querySelector('.ytp-caption-segment');
    const subtitleRect = subtitleElement ? subtitleElement.getBoundingClientRect() : null;
    const subtitleFontSize = subtitleElement ? window.getComputedStyle(subtitleElement).fontSize : "16px";

    tooltip.innerHTML = `
        <div id="translatedWord" style="font-size: ${subtitleFontSize}; font-weight: bold; cursor: pointer;">
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
        fontFamily: subtitleElement ? window.getComputedStyle(subtitleElement).fontFamily : "Arial, sans-serif",
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
        tooltip.innerHTML = `<div style="font-size: ${subtitleFontSize}; line-height: 1.4;" id="translatedSentence"></div>`;
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
