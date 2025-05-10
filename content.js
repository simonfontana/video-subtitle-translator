document.addEventListener("click", function(event) {
    let clickedElement = event.target;

    if (clickedElement && clickedElement.closest('.ytp-caption-segment')) {
        let clickedWord = "";

        const caret = document.caretPositionFromPoint(event.clientX, event.clientY);

        if (caret && caret.offsetNode.nodeType === Node.TEXT_NODE) {
            const text = caret.offsetNode.textContent;
            const offset = caret.offset;

            // Match word around the offset
            let start = offset;
            let end = offset;

            // Move backward to word start
            while (start > 0 && /\w|\p{L}/u.test(text[start - 1])) {
                start--;
            }

            // Move forward to word end
            while (end < text.length && /\w|\p{L}/u.test(text[end])) {
                end++;
            }

            clickedWord = text.slice(start, end).trim();
        }

        if (clickedWord) {
            console.log("Clicked word:", clickedWord);

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
    // Remove existing tooltip
    const existing = document.getElementById("yt-translate-tooltip");
    if (existing) existing.remove();

    const tooltip = document.createElement("div");
    tooltip.id = "yt-translate-tooltip";
    tooltip.innerText = text;

    Object.assign(tooltip.style, {
        position: "fixed",
        top: `${y + 10}px`,
        left: `${x + 10}px`,
        background: "rgba(0, 0, 0, 0.8)",
        color: "white",
        padding: "6px 10px",
        borderRadius: "6px",
        fontSize: "30px",
        zIndex: 9999,
        maxWidth: "300px",
        pointerEvents: "none",
        boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
        fontFamily: "Arial, sans-serif"
    });

    document.body.appendChild(tooltip);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        tooltip.remove();
    }, 5000);
}
