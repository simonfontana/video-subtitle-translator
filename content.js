document.addEventListener("click", function(event) {
    const clickedElement = event.target;

    if (clickedElement && clickedElement.closest('.ytp-caption-segment')) {
        let clickedWord = "";
        const caret = document.caretPositionFromPoint(event.clientX, event.clientY);

        if (caret && caret.offsetNode.nodeType === Node.TEXT_NODE) {
            const text = caret.offsetNode.textContent;
            const offset = caret.offset;

            let start = offset;
            let end = offset;

            while (start > 0 && /\w|\p{L}/u.test(text[start - 1])) start--;
            while (end < text.length && /\w|\p{L}/u.test(text[end])) end++;

            clickedWord = text.slice(start, end).trim().replace(/[.,!?;:]$/, '');
        }

        if (clickedWord) {
            const video = document.querySelector('video');
            if (video) video.pause();

            browser.runtime.sendMessage({ action: "translate", text: clickedWord }).then(response => {
                if (response && response.translation) {
                    showTooltip(response.translation, event.clientX, event.clientY);
                }
            }).catch(error => console.error("Error sending message:", error));
        }
    }
});

function showTooltip(text, x, y) {
    const existing = document.getElementById("yt-translate-tooltip");
    if (existing) existing.remove();

    const tooltip = document.createElement("div");
    tooltip.id = "yt-translate-tooltip";
    tooltip.innerText = text;

    Object.assign(tooltip.style, {
        position: "fixed",
        top: "0",
        left: "0",
        visibility: "hidden",
        background: "rgba(0, 0, 0, 0.85)",
        color: "#fff",
        padding: "14px 18px",
        borderRadius: "10px",
        fontSize: "40px",
        fontWeight: "500",
        fontFamily: "Arial, sans-serif",
        zIndex: 9999,
        maxWidth: "600px",
        lineHeight: "1.2",
        pointerEvents: "none",
        boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
        opacity: "0",
        transition: "opacity 0.3s ease"
    });

    document.body.appendChild(tooltip);

    tooltip.style.top = `${y + 10}px`;
    tooltip.style.left = `${x + 10}px`;
    tooltip.style.visibility = "visible";

    requestAnimationFrame(() => {
        tooltip.style.opacity = "1";
    });

    setTimeout(() => {
        tooltip.remove();
    }, 5000);
}
