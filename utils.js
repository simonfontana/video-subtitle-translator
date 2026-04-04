// Shared pure utility functions used by background.js (and loaded via <script> in the extension).
// Can also be require()'d from Node.js tests.

// Resolve the source and target languages for a DeepL translation request.
// settings: { sourceLang, targetLang }
// reverse:  true for reverse translation (swap source/target)
// detectedSourceLang: detected_source_language from a prior forward translation,
//   used as target_lang when the configured source is "auto" and reverse is true.
//
// Returns { sourceLang, targetLang } where sourceLang may be null (omit from API call).
function resolveLanguages(settings, reverse, detectedSourceLang) {
    const sourceLang = reverse ? settings.targetLang : settings.sourceLang || "SV";
    // When sourceLang is "auto" and this is a reverse translation, targetLang would be
    // "auto" which DeepL rejects. Fall back to detectedSourceLang from the forward
    // translation, or "SV" as a last resort.
    const rawTargetLang = reverse ? settings.sourceLang : settings.targetLang || "EN";
    const targetLang = (rawTargetLang === "auto" || !rawTargetLang)
        ? (detectedSourceLang || "SV")
        : rawTargetLang;

    return {
        sourceLang: sourceLang === "auto" ? null : sourceLang,
        targetLang,
    };
}

if (typeof module !== "undefined") {
    module.exports = { resolveLanguages };
}
