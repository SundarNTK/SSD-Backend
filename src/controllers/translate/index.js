const express = require("express");
const { responseHandler } = require("../../utilities/handlers");

/**
 * Item/Service master's "Tamil Name" field auto-fills as the admin types the
 * English name — this proxies that lookup through MyMemory's free, key-less
 * translation API. Google's unofficial translate_a/single endpoint was
 * tried first and rejected: it 429s ("Sorry...") almost immediately on
 * shared/cloud IPs, which this server runs on. MyMemory is a real public
 * API meant for exactly this kind of anonymous, no-signup use, with a
 * generous daily-per-IP quota.
 *
 * Proxied server-side rather than called directly from the browser so the
 * frontend never depends on a third party's CORS policy, and so a
 * slow/unreachable endpoint can't hang the page — it just means the admin
 * types the Tamil name themselves, same as before this existed.
 */

// Mounted at /masters — see routes/index.js (authGuard/adminOnly applied
// once for the whole /masters group there).
const router = express.Router();

// Small in-memory cache — the same handful of item/service names get
// retyped constantly across create forms; no need to re-hit Google for a
// name this process has already translated.
const cache = new Map();
const CACHE_LIMIT = 500;

async function translateText(req, res) {
  try {
    const text = String(req.query.text ?? "").trim();
    const target = String(req.query.target ?? "ta").trim();
    if (!text) return responseHandler({ res, response: { translated: "" } });

    const cacheKey = `${target}:${text.toLowerCase()}`;
    if (cache.has(cacheKey)) {
      return responseHandler({ res, response: { translated: cache.get(cacheKey) } });
    }

    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${encodeURIComponent(target)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    let translated = "";
    try {
      const apiRes = await fetch(url, { signal: controller.signal });
      if (apiRes.ok) {
        const body = await apiRes.json();
        if (body?.responseStatus === 200 || body?.responseData?.translatedText) {
          translated = body?.responseData?.translatedText ?? "";
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    if (translated) {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, translated);
    }

    return responseHandler({ res, response: { translated } });
  } catch (error) {
    // Translation is a convenience, not a required field — never fail the
    // form over it. Report an empty result instead of a 5xx.
    return responseHandler({ res, response: { translated: "" } });
  }
}

router.get("/translate", translateText);

module.exports = router;
