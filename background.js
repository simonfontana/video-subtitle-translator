browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate") {
        console.log(`[DEBUG] Received translation request: "${request.text}"`);
        translateWithDeepL(request.text)
            .then(translatedText => {
                console.log(`[DEBUG] Translation successful. Response: "${translatedText}"`);
                sendResponse({ translation: translatedText });
            })
            .catch(error => {
                console.error("[DEBUG] Translation failed:", error);
                sendResponse({ translation: "Translation failed" });
            });
        return true; // Required for async response
    }
});

async function translateWithDeepL(text) {
    const settings = await browser.storage.local.get(["sourceLang", "targetLang", "deeplApiKey"]);

    const apiKey = settings.deeplApiKey;
    if (!apiKey) {
        return "Please enter your DeepL API key in the extension popup.";
    }

    const sourceLang = settings.sourceLang || "SV";
    const targetLang = settings.targetLang || "EN";

    const url = "https://api-free.deepl.com/v2/translate";

    const params = new URLSearchParams();
    params.append("auth_key", apiKey);
    params.append("text", text);
    if (sourceLang !== "auto") {
        params.append("source_lang", sourceLang);
    }
    params.append("target_lang", targetLang);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
            mode: "cors"
        });

        const data = await response.json();
        console.log("[DEBUG] DeepL API raw response:", data);

        if (data.translations && data.translations.length > 0) {
            return data.translations[0].text;
        } else {
            console.error("[DEBUG] DeepL response error:", data);
            return "Translation error";
        }
    } catch (error) {
        console.error("[DEBUG] DeepL API fetch error:", error);
        return "Translation failed";
    }
}
