(function () {
  function safeClone(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function tryParseJson(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  function mergeMissing(target, source) {
    if (!target || !source || typeof target !== "object" || typeof source !== "object") {
      return target;
    }

    for (const [key, value] of Object.entries(source)) {
      if (target[key] == null) {
        target[key] = value;
      } else if (
        value &&
        target[key] &&
        typeof value === "object" &&
        typeof target[key] === "object" &&
        !Array.isArray(value) &&
        !Array.isArray(target[key])
      ) {
        mergeMissing(target[key], value);
      }
    }

    return target;
  }

  function flattenApiStack(target) {
    if (!target || typeof target !== "object") return target;
    const stack = Array.isArray(target.apiStack)
      ? target.apiStack
      : Array.isArray(target.data?.apiStack)
        ? target.data.apiStack
        : null;
    if (!Array.isArray(stack)) return target;

    for (const entry of stack) {
      if (!entry) continue;
      let payload = null;
      if (typeof entry.value === "string") {
        payload = tryParseJson(entry.value);
      } else if (entry.value && typeof entry.value === "object") {
        payload = entry.value;
      }
      if (!payload || typeof payload !== "object") continue;

      mergeMissing(target, payload);
      if (payload.data && typeof payload.data === "object") {
        mergeMissing(target, payload.data);
      }
    }
    return target;
  }

  function expandJsonStrings(target, depth = 0, seen = new WeakSet()) {
    if (!target || typeof target !== "object" || depth > 5 || seen.has(target)) return target;
    seen.add(target);

    for (const [key, value] of Object.entries(target)) {
      const parsed = tryParseJson(value);
      if (parsed && typeof parsed === "object") {
        target[key] = parsed;
        expandJsonStrings(parsed, depth + 1, seen);
        continue;
      }

      if (value && typeof value === "object") {
        expandJsonStrings(value, depth + 1, seen);
      }
    }

    return target;
  }

  function normalizePayload(value, sourceName) {
    if (!value || typeof value !== "object") return null;
    const cloned = safeClone(value);
    if (!cloned) return null;
    expandJsonStrings(cloned);
    flattenApiStack(cloned);
    if (cloned.data && typeof cloned.data === "object") {
      flattenApiStack(cloned.data);
      mergeMissing(cloned, cloned.data);
    }
    cloned.__tbtSource = sourceName;
    return cloned;
  }

  const capturedResponses = [];

  function shouldCaptureUrl(url) {
    const value = String(url || "");
    return /(?:mtop|h5api|detail|desc|pcdetail|itemDesc|imageTextInfo|icoss)/i.test(value);
  }

  function normalizeUrlLikeText(value) {
    return String(value || "")
      .replace(/&amp;/g, "&")
      .replace(/\\u002F/gi, "/")
      .replace(/\\\//g, "/");
  }

  function extractImageUrlsFromText(text) {
    const urls = [];
    const seen = new Set();
    const normalized = normalizeUrlLikeText(text);
    const pattern =
      /((?:https?:)?\/\/(?:img|gw|g-search|gd|imgextra)\.alicdn\.com\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|gif|bmp|avif)(?:\?[^"'\\\s<>]*)?)/gi;
    let matched;

    while ((matched = pattern.exec(normalized))) {
      const url = matched[1];
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      if (urls.length >= 600) break;
    }

    return urls;
  }

  function isLikelyDetailResponse(url, body) {
    const value = String(url || "");
    if (/desc|imageTextInfo|itemDesc|pcdetail/i.test(value)) return true;
    return /pcDescContent|mobileDescContent|wdescContent|descContent|图文详情|商品详情/i.test(body.slice(0, 120000));
  }

  function rememberResponse(url, body, source, contentType) {
    if (!url || !body || typeof body !== "string") return;
    if (!shouldCaptureUrl(url) && !/desc|image|pic|img|sku|apiStack|pcDescContent/i.test(body.slice(0, 4000))) {
      return;
    }

    capturedResponses.push({
      url: String(url),
      source,
      contentType: contentType || "",
      body: body.slice(0, 6_000_000),
      imageUrls: extractImageUrlsFromText(body),
      likelyDetail: isLikelyDetailResponse(url, body),
      ts: Date.now()
    });

    while (capturedResponses.length > 40) {
      capturedResponses.shift();
    }
  }

  function installFetchCapture() {
    if (!window.fetch || window.__tbtFetchCaptureInstalled) return;
    window.__tbtFetchCaptureInstalled = true;
    const originalFetch = window.fetch;

    window.fetch = function (...args) {
      const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url;
      return originalFetch.apply(this, args).then(response => {
        try {
          const url = response.url || requestUrl;
          if (shouldCaptureUrl(url)) {
            response.clone().text().then(text => {
              rememberResponse(url, text, "fetch", response.headers?.get("content-type") || "");
            }).catch(() => {});
          }
        } catch {
          // ignore capture errors
        }
        return response;
      });
    };
  }

  function installXhrCapture() {
    if (!window.XMLHttpRequest || window.__tbtXhrCaptureInstalled) return;
    window.__tbtXhrCaptureInstalled = true;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__tbtUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener("load", () => {
        try {
          const url = this.responseURL || this.__tbtUrl;
          if (!shouldCaptureUrl(url)) return;
          if (this.responseType && this.responseType !== "text" && this.responseType !== "") return;
          rememberResponse(
            url,
            this.responseText || "",
            "xhr",
            this.getResponseHeader("content-type") || ""
          );
        } catch {
          // ignore capture errors
        }
      });

      return originalSend.apply(this, args);
    };
  }

  installFetchCapture();
  installXhrCapture();

  function readKnownGlobals() {
    const sources = [
      () => window.runParams && (window.runParams.data || window.runParams),
      () => window.__INIT_DATA__,
      () => window.__GLOBAL_DATA__,
      () => window.g_config && (window.g_config.data || window.g_config),
      () => window.MIST_DATA,
      () => window.__NEXT_DATA__ && window.__NEXT_DATA__.props
    ];

    const merged = {};
    const sourceNames = [];

    for (const [index, fn] of sources.entries()) {
      try {
        const value = fn();
        const normalized = normalizePayload(value, `global-${index}`);
        if (!normalized) continue;
        mergeMissing(merged, normalized);
        sourceNames.push(normalized.__tbtSource);
      } catch {
        // ignore
      }
    }

    if (!Object.keys(merged).length) return null;
    merged.__tbtSources = sourceNames;
    return merged;
  }

  function readFromInlineScripts() {
    const scripts = Array.from(document.scripts || []).slice(0, 200);
    for (const script of scripts) {
      const text = script.textContent || "";
      if (!text || text.length > 4_000_000) continue;

      const assignmentMatch = text.match(
        /(?:window\.)?(?:__INIT_DATA__|__GLOBAL_DATA__)\s*=\s*({[\s\S]+?})\s*;?\s*$/
      );
      if (assignmentMatch) {
        const parsed = tryParseJson(assignmentMatch[1]);
        const normalized = normalizePayload(parsed, "inline-json");
        if (normalized) return normalized;
      }

      const jsonScript = script.type === "application/json" ? tryParseJson(text) : null;
      const normalized = normalizePayload(jsonScript, "inline-application-json");
      if (normalized) return normalized;
    }
    return null;
  }

  function buildPayload() {
    const data = readKnownGlobals() || readFromInlineScripts() || {};
    if (capturedResponses.length) {
      data.__tbtNetworkResponses = safeClone(capturedResponses) || [];
      data.__tbtSources = Array.from(new Set([...(data.__tbtSources || []), "network"]));
    }
    return Object.keys(data).length ? data : null;
  }

  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.__TBT_REQ__ !== true) return;

    let data = null;
    let error = null;
    try {
      data = buildPayload();
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    }

    window.postMessage(
      {
        __TBT_RES__: true,
        requestId: message.requestId || null,
        data,
        error
      },
      "*"
    );
  });
})();
