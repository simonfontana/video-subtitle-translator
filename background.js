browser.runtime.onMessage.addListener(async (request) => {
    if (request.action === "translate") {
        const translatedText = await translateWithDeepL(request.text);
        return Promise.resolve({ translation: translatedText });
    }
});

async function translateWithDeepL(text) {
    const settings = await browser.storage.local.get(["sourceLang", "targetLang", "deeplApiKey"]);

    const apiKey = settings.deeplApiKey;
    if (!apiKey) {
        console.error("No DeepL API key set");
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

        if (data.translations && data.translations.length > 0) {
            return data.translations[0].text;
        } else {
            console.error("DeepL response error:", data);
            return "Translation error";
        }
    } catch (error) {
        console.error("DeepL API error:", error);
        return "Translation failed";
    }
}
