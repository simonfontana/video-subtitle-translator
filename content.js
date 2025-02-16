document.addEventListener("click", function (event) {
    let clickedElement = event.target;
    
    // Check if the clicked element is a subtitle text span
    if (clickedElement && clickedElement.closest('.ytp-caption-segment')) {
        let word = clickedElement.innerText.trim();

        if (word) {
            // Pause video
            document.querySelector('video').pause();
            
            // Send word to background for translation
            browser.runtime.sendMessage({ action: "translate", text: word }).then(response => {
                if (response && response.translation) {
                    alert(`Translation: ${response.translation}`);
                }
            }).catch(error => console.error("Error sending message:", error));
        }
    }
});
