browser.runtime.onMessage.addListener(async function (request, sender, sendResponse) {
    if (request.action === "translate") {
        let translatedText = await fetchTranslation(request.text);
        return Promise.resolve({ translation: translatedText }); // Fix for Firefox
    }
});

async function fetchTranslation(text) {
    let url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=sv|en`;

    try {
        let response = await fetch(url);
        let data = await response.json();
        
        if (data.responseData && data.responseData.translatedText) {
            return data.responseData.translatedText;
        } else {
            console.error("Translation API error:", data);
            return "Translation unavailable";
        }
    } catch (error) {
        console.error("Translation error:", error);
        return "Error translating";
    }
}
