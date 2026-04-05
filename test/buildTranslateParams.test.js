const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildTranslateParams } = require("../utils.js");

describe("buildTranslateParams", () => {
    it("includes text and target_lang", () => {
        const params = buildTranslateParams("hello", { sourceLang: "EN", targetLang: "SV" });
        assert.equal(params.get("text"), "hello");
        assert.equal(params.get("target_lang"), "SV");
    });

    it("includes source_lang when sourceLang is non-null", () => {
        const params = buildTranslateParams("hello", { sourceLang: "EN", targetLang: "SV" });
        assert.equal(params.get("source_lang"), "EN");
    });

    it("omits source_lang when sourceLang is null (auto-detect)", () => {
        const params = buildTranslateParams("hello", { sourceLang: null, targetLang: "SV" });
        assert.equal(params.get("source_lang"), null);
    });
});
