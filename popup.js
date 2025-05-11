const sourceSelect = document.getElementById("sourceLang");
const targetSelect = document.getElementById("targetLang");

browser.storage.local.get(["sourceLang", "targetLang"]).then(data => {
    if (data.sourceLang) sourceSelect.value = data.sourceLang;
    if (data.targetLang) targetSelect.value = data.targetLang;
});

sourceSelect.addEventListener("change", () => {
    browser.storage.local.set({ sourceLang: sourceSelect.value });
});
targetSelect.addEventListener("change", () => {
    browser.storage.local.set({ targetLang: targetSelect.value });
});

