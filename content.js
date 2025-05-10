document.addEventListener("click", function (event) {
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
                    alert(`Translation: ${response.translation}`);
                }
            }).catch(error => console.error("Error sending message:", error));
        }
    }
});
