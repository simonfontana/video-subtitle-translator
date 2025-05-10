let DEEPL_API_KEY = null;

// Load the secret API key from secrets.json
fetch(browser.runtime.getURL("secrets.json"))
    .then(res => res.json())
    .then(data => {
        DEEPL_API_KEY = data.deeplApiKey;
        console.log("Loaded DeepL API key");
    })
    .catch(err => console.error("Failed to load API key:", err));

browser.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === "translate") {
        const translatedText = await translateWithDeepL(request.text);
        return Promise.resolve({ translation: translatedText });
    }
});

async function translateWithDeepL(text) {
    if (!DEEPL_API_KEY) {
        console.error("DeepL API key not loaded");
        return "API key not available";
    }

    const url = "https://api-free.deepl.com/v2/translate";

    const params = new URLSearchParams();
    params.append("auth_key", DEEPL_API_KEY);
    params.append("text", text);
    params.append("source_lang", "SV");
    params.append("target_lang", "EN");

    try {
        console.log("Sending translation request:", text);
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
            mode: "cors"
        });

        const data = await response.json();
        console.log("DeepL response:", data);

        if (data.translations && data.translations.length > 0) {
            return data.translations[0].text;
        } else {
            return "Translation error (no translations)";
        }
    } catch (error) {
        console.error("DeepL API error:", error);
        return "Translation failed";
    }
}
