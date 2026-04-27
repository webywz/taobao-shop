(function () {
  const taskId = new URLSearchParams(location.search).get("__task_id");
  if (!taskId) return;

  function sleep(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  const PLACEHOLDER_IMAGE_PATTERN =
    /(placeholder|blank|empty|default|loading|lazyload|transparent|pixel|spacer|grey|gray|nopic|noimage)/i;
  const LAZY_PLACEHOLDER_URL_PATTERN =
    /(?:^|\/\/)(?:g\.alicdn\.com\/s\.gif|g\.alicdn\.com\/imgextra\/.+?\/s\.gif|.+\/s\.gif)(?:$|\?)/i;
  const PLACEHOLDER_ELEMENT_PATTERN =
    /(placeholder|skeleton|loading|lazyload-placeholder|image-placeholder|blank|empty)/i;

  function getText(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = el?.innerText?.replace(/\s+/g, " ").trim();
      if (text) return text;
    }
    return null;
  }

  function getViewportHeight(view = window) {
    return view?.innerHeight || window.innerHeight || 0;
  }

  function getDocumentHeight(doc = document, view = doc.defaultView || window) {
    const body = doc.body;
    const root = doc.documentElement;
    return Math.max(
      body?.scrollHeight || 0,
      body?.offsetHeight || 0,
      root?.scrollHeight || 0,
      root?.offsetHeight || 0,
      root?.clientHeight || 0,
      getViewportHeight(view)
    );
  }

  function getImageStabilitySnapshot(doc = document) {
    const images = Array.from(doc.images);
    return {
      total: images.length,
      loaded: images.filter(image => (image.naturalWidth || 0) > 0 || (image.naturalHeight || 0) > 0).length
    };
  }

  async function waitForImageSettle(timeoutMs, doc = document) {
    const deadline = Date.now() + timeoutMs;
    let stableRounds = 0;
    let lastSnapshot = getImageStabilitySnapshot(doc);

    while (Date.now() < deadline) {
      await sleep(350);
      const nextSnapshot = getImageStabilitySnapshot(doc);

      if (nextSnapshot.total === lastSnapshot.total && nextSnapshot.loaded === lastSnapshot.loaded) {
        stableRounds += 1;
        if (stableRounds >= 2) return;
      } else {
        stableRounds = 0;
        lastSnapshot = nextSnapshot;
      }
    }
  }

  async function warmUpDocument(doc = document, view = doc.defaultView || window) {
    const step = Math.max(Math.round(getViewportHeight(view) * 0.9), 700);
    let currentHeight = getDocumentHeight(doc, view);

    for (let top = 0; top <= currentHeight; top += step) {
      view.scrollTo({ top, behavior: "instant" });
      await waitForImageSettle(700, doc);
      currentHeight = Math.max(currentHeight, getDocumentHeight(doc, view));
    }

    view.scrollTo({ top: currentHeight, behavior: "instant" });
    await waitForImageSettle(900, doc);

    view.scrollTo({ top: 0, behavior: "instant" });
    await waitForImageSettle(500, doc);
  }

  async function warmUpLazyContent() {
    await warmUpDocument(document, window);
  }

  const IMAGE_DATA_ATTRIBUTES = [
    "data-src",
    "data-lazy-src",
    "data-ks-lazyload",
    "data-bg",
    "data-background",
    "data-background-image",
    "data-origin-src",
    "data-src-retina",
    "data-lazyload"
  ];

  function collectImageUrlFromElement(element) {
    const deferredSources = [
      element.dataset.src,
      element.dataset.ksLazyload,
      element.getAttribute("data-src"),
      element.getAttribute("data-lazy-src"),
      element.getAttribute("data-ks-lazyload")
    ].filter(Boolean);

    const immediateSources = [
      element.currentSrc,
      element.src
    ].filter(Boolean);

    const hasMeaningfulImmediateSource = immediateSources.some(source => !isPlaceholderImageUrl(source));
    if (hasMeaningfulImmediateSource) {
      return immediateSources.find(source => !isPlaceholderImageUrl(source));
    }

    if (deferredSources.length) {
      return deferredSources[0];
    }

    return immediateSources[0] || null;
  }

  function isPlaceholderImageUrl(sourceUrl) {
    if (!sourceUrl) return true;
    return PLACEHOLDER_IMAGE_PATTERN.test(sourceUrl) || LAZY_PLACEHOLDER_URL_PATTERN.test(sourceUrl);
  }

  function isPlaceholderImageElement(element) {
    if (!(element instanceof HTMLImageElement)) return false;

    const markerText = [
      element.className,
      element.getAttribute("data-name") || "",
      element.getAttribute("data-type") || "",
      element.getAttribute("data-role") || "",
      element.getAttribute("aria-label") || "",
      element.alt || ""
    ].join(" ");

    if (PLACEHOLDER_ELEMENT_PATTERN.test(markerText)) {
      const deferredSource =
        element.dataset.src ||
        element.dataset.ksLazyload ||
        element.getAttribute("data-src") ||
        element.getAttribute("data-lazy-src") ||
        element.getAttribute("data-ks-lazyload");

      if (!deferredSource || isPlaceholderImageUrl(deferredSource)) {
        return true;
      }
    }

    const currentLikeSource = element.currentSrc || element.src || "";
    if (isPlaceholderImageUrl(currentLikeSource)) {
      const deferredSource =
        element.dataset.src ||
        element.dataset.ksLazyload ||
        element.getAttribute("data-src") ||
        element.getAttribute("data-lazy-src") ||
        element.getAttribute("data-ks-lazyload");

      if (!deferredSource || isPlaceholderImageUrl(deferredSource)) {
        return true;
      }
    }

    const width = element.naturalWidth || element.width || Math.round(element.getBoundingClientRect().width) || 0;
    const height = element.naturalHeight || element.height || Math.round(element.getBoundingClientRect().height) || 0;
    if (width <= 2 && height <= 2) {
      return true;
    }

    return false;
  }

  function extractUrlsFromCssValue(value) {
    const urls = [];
    if (!value || value === "none") return urls;

    const urlPattern = /url\((['"]?)(.*?)\1\)/gi;
    let matched;
    while ((matched = urlPattern.exec(value))) {
      if (matched[2]) {
        urls.push(matched[2]);
      }
    }

    return urls;
  }

  function collectCandidateUrlsFromElement(element) {
    const urls = new Set();

    if (element instanceof HTMLImageElement) {
      const directUrl = collectImageUrlFromElement(element);
      if (directUrl) urls.add(directUrl);
    }

    for (const attribute of IMAGE_DATA_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (value) urls.add(value);
    }

    return Array.from(urls);
  }

  function isIgnoredImageUrl(sourceUrl) {
    if (!sourceUrl) return true;
    return (
      sourceUrl.startsWith("data:") ||
      sourceUrl.startsWith("blob:") ||
      /\.(svg)(?:$|\?)/i.test(sourceUrl) ||
      isPlaceholderImageUrl(sourceUrl) ||
      /(sprite|icon|logo|avatar|coupon|badge|qr|qrcode)/i.test(sourceUrl)
    );
  }

  function isLogoLikeElement(element) {
    const logoPattern = /logo/i;
    const ownMarkers = [
      element instanceof HTMLImageElement ? element.alt : "",
      element.getAttribute("title") || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("data-name") || "",
      element.getAttribute("data-title") || "",
      element.id,
      typeof element.className === "string" ? element.className : ""
    ].join(" ");

    if (logoPattern.test(ownMarkers) || /店铺logo|品牌logo/i.test(ownMarkers)) {
      return true;
    }

    let current = element.parentElement;
    for (let depth = 0; current && depth < 1; depth += 1, current = current.parentElement) {
      const containerMarkers = [
        current.id,
        typeof current.className === "string" ? current.className : "",
        current.getAttribute("title") || "",
        current.getAttribute("aria-label") || "",
        current.getAttribute("data-name") || "",
        current.getAttribute("data-type") || "",
        current.getAttribute("data-role") || ""
      ].join(" ");

      if (logoPattern.test(containerMarkers) || /店铺logo|品牌logo/i.test(containerMarkers)) {
        return true;
      }
    }

    return false;
  }

  function createCandidatesFromElement(element, topOffset, options = {}) {
    if (isInExcludedSection(element)) return [];
    if (isLogoLikeElement(element)) return [];
    if (element instanceof HTMLImageElement && isEmptyImageElement(element)) return [];
    if (isPlaceholderImageElement(element)) return [];

    const rect = element.getBoundingClientRect();
    const top = topOffset + rect.top;
    if (options.cutoffTop != null && top >= options.cutoffTop) return [];
    if (options.minTop != null && top < options.minTop) return [];

    const width =
      element instanceof HTMLImageElement
        ? element.naturalWidth || Math.round(rect.width) || element.width || undefined
        : Math.round(rect.width) || undefined;
    const height =
      element instanceof HTMLImageElement
        ? element.naturalHeight || Math.round(rect.height) || element.height || undefined
        : Math.round(rect.height) || undefined;

    if ((!width && !height) || isTooSmallImage(
      width || 0,
      height || 0,
      options.minShortestEdge ?? 60,
      options.minArea ?? 3600
    )) {
      return [];
    }

    const localSeen = new Set();
    const candidates = [];
    for (const rawUrl of collectCandidateUrlsFromElement(element)) {
      const url = rawUrl ? normalizeImageUrl(rawUrl) : null;
      if (!url || isIgnoredImageUrl(url) || localSeen.has(url)) continue;
      localSeen.add(url);

      candidates.push({
        url,
        width,
        height,
        top,
        area: (width || 0) * (height || 0),
        skuName: options.extractSku && element instanceof HTMLImageElement ? readSkuName(element) : null
      });
    }

    return candidates;
  }

  function normalizeImageUrl(rawUrl) {
    try {
      let urlStr = String(rawUrl)
        .trim()
        .replace(/&amp;/g, "&")
        .replace(/\\u002F/gi, "/")
        .replace(/\\\//g, "/")
        .replace(/^url\((['"]?)(.*?)\1\)$/i, "$2")
        .replace(/^['"]|['"]$/g, "")
        .replace(/_[0-9]+x[0-9]+(?:q[0-9]+)?(?:s[0-9]+)?(?:_[a-z0-9]+)?(?=\.(?:jpg|jpeg|png|webp|avif)|$)/gi, "")
        .replace(/\.avif_\.webp(?=$|\?)/i, ".avif");
      if (/^(?:img|gw|g-search|gd|imgextra)\.alicdn\.com\//i.test(urlStr)) {
        urlStr = `https://${urlStr}`;
      }
      const url = new URL(urlStr, window.location.href);
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }

  function readSkuName(element) {
    const namedContainer = element.closest("[data-value], [data-sku], li, button, label, div");
    if (!namedContainer) return null;

    const rawName =
      namedContainer.getAttribute("title") ||
      namedContainer.getAttribute("aria-label") ||
      namedContainer.getAttribute("data-value") ||
      namedContainer.getAttribute("data-sku") ||
      namedContainer.textContent;

    const normalized = rawName?.replace(/\s+/g, " ").trim();
    return normalized ? normalized.slice(0, 60) : null;
  }

  function normalizeTextContent(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function buildDedupeKey(sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      return `${url.origin}${url.pathname}`;
    } catch {
      return sourceUrl;
    }
  }

  function dedupeUrlList(urls) {
    const seen = new Set();
    const output = [];

    for (const url of urls) {
      const normalized = url ? normalizeImageUrl(url) : null;
      if (!normalized || isIgnoredImageUrl(normalized)) continue;

      const key = buildDedupeKey(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(normalized);
    }

    return output;
  }

  function isTooSmallImage(width, height, minShortestEdge = 60, minArea = 3600) {
    if (!width || !height) return false;
    const shortestEdge = Math.min(width, height);
    const area = width * height;
    return shortestEdge < minShortestEdge || area < minArea;
  }

  function parseImageSizeHintFromUrl(sourceUrl) {
    if (!sourceUrl) return null;

    try {
      const url = new URL(sourceUrl, window.location.href);
      const queryWidth =
        Number(url.searchParams.get("w")) ||
        Number(url.searchParams.get("width")) ||
        Number(url.searchParams.get("imgWidth"));
      const queryHeight =
        Number(url.searchParams.get("h")) ||
        Number(url.searchParams.get("height")) ||
        Number(url.searchParams.get("imgHeight"));

      if (queryWidth > 0 && queryHeight > 0) {
        return { width: queryWidth, height: queryHeight };
      }

      const path = `${url.pathname}${url.search}`;
      const matched = path.match(/(?:_|-|@)(\d{2,4})x(\d{2,4})(?:[_.-]|$|\?)/i) || path.match(/(\d{2,4})x(\d{2,4})(?=\.)/i);
      if (!matched) return null;

      const width = Number(matched[1]);
      const height = Number(matched[2]);
      if (!width || !height) return null;
      return { width, height };
    } catch {
      return null;
    }
  }

  function isLikelyTooSmallDetailImageUrl(sourceUrl) {
    const hint = parseImageSizeHintFromUrl(sourceUrl);
    if (!hint) return false;
    return isTooSmallImage(hint.width, hint.height, 120, 20000);
  }

  function isEmptyImageElement(element) {
    const naturalWidth = element.naturalWidth || 0;
    const naturalHeight = element.naturalHeight || 0;

    if (naturalWidth === 1 && naturalHeight === 1) return true;
    if (element.complete && naturalWidth === 0 && naturalHeight === 0) return true;
    return false;
  }

  function getCombinedSelector(selectors) {
    return selectors.join(", ");
  }

  const EXCLUDED_SECTION_KEYWORDS = [
    "88vip",
    "88 vip",
    "本店推荐",
    "店铺推荐",
    "推荐商品",
    "猜你喜欢",
    "看了又看",
    "相似推荐"
  ];

  const TRAILING_SECTION_KEYWORDS = [
    "本店推荐",
    "店铺推荐",
    "推荐商品",
    "猜你喜欢",
    "看了又看",
    "相似推荐"
  ];

  const EXCLUDED_SECTION_SELECTOR = [
    "[class*='recommend']",
    "[id*='recommend']",
    "[class*='guess']",
    "[id*='guess']",
    "[class*='similar']",
    "[id*='similar']",
    "[class*='related']",
    "[id*='related']",
    "[class*='vip']",
    "[id*='vip']"
  ].join(", ");

  function normalizeSectionText(value) {
    return (value || "").replace(/\s+/g, "").toLowerCase();
  }

  function containsSectionKeyword(value, keywords) {
    const normalized = normalizeSectionText(value);
    return keywords.some(keyword => normalized.includes(normalizeSectionText(keyword)));
  }

  function isInExcludedSection(element) {
    if (EXCLUDED_SECTION_SELECTOR && element.closest(EXCLUDED_SECTION_SELECTOR)) {
      return true;
    }

    let current = element;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      const markerText = [
        current.id,
        typeof current.className === "string" ? current.className : "",
        current.getAttribute("data-spm") || "",
        current.getAttribute("aria-label") || "",
        current.getAttribute("title") || ""
      ].join(" ");

      if (containsSectionKeyword(markerText, EXCLUDED_SECTION_KEYWORDS)) {
        return true;
      }
    }

    return false;
  }

  function getRecommendationCutoffTop() {
    let cutoffTop = null;
    const nodes = Array.from(document.querySelectorAll("h2, h3, h4, strong, [class], [id], [data-spm]")).slice(0, 2000);

    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      const text = node.innerText || node.textContent || "";
      const compactText = normalizeSectionText(text);
      if (!compactText || compactText.length > 40) continue;
      if (!containsSectionKeyword(compactText, TRAILING_SECTION_KEYWORDS)) continue;
      if (node.children.length > 8) continue;

      const rect = node.getBoundingClientRect();
      const top = window.scrollY + rect.top;
      if (top <= window.innerHeight * 1.2) continue;

      cutoffTop = cutoffTop === null ? top : Math.min(cutoffTop, top);
    }

    return cutoffTop;
  }

  function matchesRegion(element, selector) {
    if (!selector) return false;
    try {
      return Boolean(element.closest(selector));
    } catch {
      return false;
    }
  }

  function dedupeCandidates(candidates) {
    const selected = new Map();

    function getArea(candidate) {
      return candidate.area || (candidate.width || 0) * (candidate.height || 0);
    }

    function isBetterCandidate(next, current) {
      const nextArea = getArea(next);
      const currentArea = getArea(current);
      if (nextArea !== currentArea) return nextArea > currentArea;

      const nextLongest = Math.max(next.width || 0, next.height || 0);
      const currentLongest = Math.max(current.width || 0, current.height || 0);
      if (nextLongest !== currentLongest) return nextLongest > currentLongest;

      return (next.skuName?.length || 0) > (current.skuName?.length || 0);
    }

    candidates.forEach((candidate, index) => {
      const key = buildDedupeKey(candidate.url);
      const existing = selected.get(key);

      if (!existing) {
        selected.set(key, { candidate, firstIndex: index });
        return;
      }

      if (isBetterCandidate(candidate, existing.candidate)) {
        selected.set(key, { candidate, firstIndex: existing.firstIndex });
      }
    });

    return Array.from(selected.values())
      .sort((left, right) => left.firstIndex - right.firstIndex)
      .map(item => item.candidate);
  }

  function collectAccessibleDocuments() {
    const docs = [];
    const visited = new Set();

    function visit(doc, topOffset, fromIframe) {
      if (!doc || visited.has(doc)) return;
      visited.add(doc);
      docs.push({ doc, topOffset, fromIframe });

      const iframes = Array.from(doc.querySelectorAll("iframe"));
      for (const iframe of iframes) {
        try {
          const nestedDocument = iframe.contentDocument;
          if (!nestedDocument) continue;
          const rect = iframe.getBoundingClientRect();
          visit(nestedDocument, topOffset + rect.top, true);
        } catch {
          // Ignore cross-origin frames.
        }
      }
    }

    visit(document, 0, false);
    return docs;
  }

  function extractBySelectors(selectors, limit, options = {}) {
    const candidates = [];
    const docs = options.checkAllDocs ? collectAccessibleDocuments() : [{ doc: document }];

    for (const { doc, topOffset } of docs) {
      const elements = selectors.flatMap(selector =>
        Array.from(doc.querySelectorAll(selector)).filter(node => node instanceof HTMLImageElement)
      );

      for (const element of elements) {
        const extracted = createCandidatesFromElement(element, topOffset, options);
        for (const candidate of extracted) {
          if (options.predicate && !options.predicate(candidate)) continue;
          candidates.push(candidate);
        }
      }
    }

    return dedupeCandidates(candidates).slice(0, limit);
  }

  function extractDetailContainerAssets(containerSelectors, limit, options = {}) {
    const candidates = [];
    const docs = options.checkAllDocs ? collectAccessibleDocuments() : [{ doc: document, topOffset: 0 }];
    const mediaSelector = [
      "img",
      "[data-src]",
      "[data-lazy-src]",
      "[data-ks-lazyload]",
      "[data-bg]",
      "[data-background]",
      "[data-background-image]",
      "[data-origin-src]"
    ].join(", ");

    for (const { doc, topOffset } of docs) {
      const containers = containerSelectors.flatMap(selector =>
        Array.from(doc.querySelectorAll(selector)).filter(node => node instanceof HTMLElement)
      );

      const elements = new Set();
      for (const container of containers) {
        if (container.matches(mediaSelector)) {
          elements.add(container);
        }
        for (const node of Array.from(container.querySelectorAll(mediaSelector))) {
          if (node instanceof HTMLElement) {
            elements.add(node);
          }
        }
      }

      for (const element of elements) {
        const extracted = createCandidatesFromElement(element, topOffset, options);
        for (const candidate of extracted) {
          if (options.predicate && !options.predicate(candidate)) continue;
          candidates.push(candidate);
        }
      }
    }

    return dedupeCandidates(candidates).slice(0, limit);
  }

  function collectStructuredDetailImageNodes(root) {
    const preferredSelector = [
      "img[data-name='singleImage']",
      "img.descV8-singleImage-image",
      "img[data-name='picJumper']",
      "img.descV8-picJumper-image",
      ".descV8-singleImage img",
      ".descV8-picJumper img",
      "img"
    ].join(", ");

    return Array.from(root.querySelectorAll(preferredSelector)).filter(node => {
      if (!(node instanceof HTMLImageElement)) return false;
      if (isPlaceholderImageElement(node)) return false;
      if (isLogoLikeElement(node)) return false;

      const rawUrl = collectImageUrlFromElement(node);
      const url = rawUrl ? normalizeImageUrl(rawUrl) : null;
      if (!url || isIgnoredImageUrl(url) || isLikelyTooSmallDetailImageUrl(url)) return false;

      const rect = node.getBoundingClientRect();
      const width = node.naturalWidth || Math.round(rect.width) || node.width || 0;
      const height = node.naturalHeight || Math.round(rect.height) || node.height || 0;
      if (isTooSmallImage(width, height, 120, 20000)) return false;
      return true;
    });
  }

  function collectStructuredDetailContent(rootSelectors, options = {}) {
    let selectedRoot = null;
    let selectedTopOffset = 0;
    let selectedSelector = null;
    let selectedScore = -1;

    for (const { doc, topOffset } of collectAccessibleDocuments()) {
      rootSelectors.forEach((selector, selectorIndex) => {
        const roots = Array.from(doc.querySelectorAll(selector)).filter(node => node instanceof HTMLElement);

        for (const root of roots) {
          const imageCount = collectStructuredDetailImageNodes(root).length;
          const textLength = normalizeTextContent(root.innerText || root.textContent || "").length;
          const priorityBoost = Math.max(0, rootSelectors.length - selectorIndex) * 100000;
          const score = priorityBoost + imageCount * 1000 + Math.min(textLength, 2000);

          if (score > selectedScore) {
            selectedRoot = root;
            selectedTopOffset = topOffset;
            selectedSelector = selector;
            selectedScore = score;
          }
        }
      });
    }

    if (!selectedRoot) {
      return {
        rootSelector: null,
        blocks: [],
        imageUrls: []
      };
    }

    const blocks = [];
    const seenText = new Set();
    const imageUrls = [];

    for (const image of collectStructuredDetailImageNodes(selectedRoot)) {
      const rawUrl = collectImageUrlFromElement(image);
      const url = rawUrl ? normalizeImageUrl(rawUrl) : null;
      if (!url || isIgnoredImageUrl(url)) continue;

      const rect = image.getBoundingClientRect();
      const top = selectedTopOffset + rect.top;

      const width = image.naturalWidth || Math.round(rect.width) || image.width || undefined;
      const height = image.naturalHeight || Math.round(rect.height) || image.height || undefined;
      imageUrls.push(url);
      blocks.push({
        type: "image",
        url,
        top,
        width,
        height
      });
    }

    const textSelectors = [
      ".descV8-componentTitle-text",
      ".descV8-richText",
      ".descV8-text",
      ".descV8-textLine",
      "p",
      "h1",
      "h2",
      "h3",
      "h4",
      "li"
    ].join(", ");

    for (const node of Array.from(selectedRoot.querySelectorAll(textSelectors))) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.querySelector("img")) continue;

      const text = normalizeTextContent(node.innerText || node.textContent || "");
      if (!text || text.length < 2) continue;

      const textKey = `${text}|${Math.round(node.getBoundingClientRect().top)}`;
      if (seenText.has(textKey)) continue;
      seenText.add(textKey);

      const rect = node.getBoundingClientRect();
      const top = selectedTopOffset + rect.top;

      blocks.push({
        type: "text",
        text,
        top
      });
    }

    return {
      rootSelector: selectedSelector,
      blocks: blocks.sort((left, right) => {
        if ((left.top || 0) !== (right.top || 0)) return (left.top || 0) - (right.top || 0);
        if (left.type === right.type) return 0;
        return left.type === "text" ? -1 : 1;
      }),
      imageUrls: dedupeUrlList(imageUrls)
    };
  }

  function collectAllCandidates(mainRegionSelector, skuRegionSelector, detailRegionSelector, cutoffTop) {
    const candidates = [];

    for (const { doc, topOffset, fromIframe } of collectAccessibleDocuments()) {
      for (const element of Array.from(doc.images)) {
        if (isInExcludedSection(element)) continue;
        if (isLogoLikeElement(element)) continue;
        if (isEmptyImageElement(element)) continue;

        const rawUrl = collectImageUrlFromElement(element);
        const url = rawUrl ? normalizeImageUrl(rawUrl) : null;
        if (!url || isIgnoredImageUrl(url)) continue;

        const rect = element.getBoundingClientRect();
        const top = topOffset + rect.top;
        if (cutoffTop != null && top >= cutoffTop) continue;

        const width = element.naturalWidth || Math.round(rect.width) || element.width || undefined;
        const height = element.naturalHeight || Math.round(rect.height) || element.height || undefined;
        if (isTooSmallImage(width || 0, height || 0, 60, 3600)) continue;

        candidates.push({
          url,
          width,
          height,
          top,
          area: (width || 0) * (height || 0),
          skuName: matchesRegion(element, skuRegionSelector) ? readSkuName(element) : null,
          inMainRegion: matchesRegion(element, mainRegionSelector),
          inSkuRegion: matchesRegion(element, skuRegionSelector),
          inDetailRegion: fromIframe || matchesRegion(element, detailRegionSelector),
          fromIframe
        });
      }
    }

    return candidates;
  }

  function rankByVisualPriority(candidates) {
    return [...candidates].sort((left, right) => {
      const leftArea = left.area || (left.width || 0) * (left.height || 0);
      const rightArea = right.area || (right.width || 0) * (right.height || 0);
      if (rightArea !== leftArea) return rightArea - leftArea;
      return (left.top || 0) - (right.top || 0);
    });
  }

  function isLikelyDetailImage(candidate) {
    const width = candidate.width || 0;
    const height = candidate.height || 0;
    if (!width || !height) return true;

    const shortestEdge = Math.min(width, height);
    const longestEdge = Math.max(width, height);
    const area = width * height;

    if (longestEdge < 240) return false;
    if (shortestEdge < 80) return false;
    if (area < 20000) return false;
    return true;
  }

  function isLikelyStructuredDetailAsset(candidate) {
    const width = candidate.width || 0;
    const height = candidate.height || 0;
    if (!width || !height) return true;

    const shortestEdge = Math.min(width, height);
    const longestEdge = Math.max(width, height);
    const area = width * height;

    if (longestEdge < 180) return false;
    if (shortestEdge < 60) return false;
    if (area < 12000) return false;
    return true;
  }

  function excludeKnownProductImages(candidates, excludedCandidates) {
    const excludedKeys = new Set(excludedCandidates.map(candidate => buildDedupeKey(candidate.url)));
    return candidates.filter(candidate => !excludedKeys.has(buildDedupeKey(candidate.url)));
  }

  function selectDetailCandidates(allCandidates, excludedCandidates) {
    const seen = new Set();

    return excludeKnownProductImages(allCandidates, excludedCandidates)
      .filter(candidate => {
        const width = candidate.width || 0;
        const height = candidate.height || 0;
        const shortestEdge = Math.min(width, height);
        const longestEdge = Math.max(width, height);
        const area = candidate.area || width * height;
        const belowFold = (candidate.top || 0) > window.innerHeight * 0.55;

        if (!candidate.inDetailRegion && !belowFold) return false;
        if (longestEdge < 240) return false;
        if (shortestEdge < 80) return false;
        if (area < 20000) return false;

        const key = buildDedupeKey(candidate.url);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => {
        const leftScore =
          (left.inDetailRegion ? 1000 : 0) +
          (left.fromIframe ? 400 : 0) +
          ((left.top || 0) > window.innerHeight ? 200 : 0);
        const rightScore =
          (right.inDetailRegion ? 1000 : 0) +
          (right.fromIframe ? 400 : 0) +
          ((right.top || 0) > window.innerHeight ? 200 : 0);

        if (rightScore !== leftScore) return rightScore - leftScore;
        if ((right.area || 0) !== (left.area || 0)) return (right.area || 0) - (left.area || 0);
        return (left.top || 0) - (right.top || 0);
      })
      .slice(0, 30);
  }

  function getVideoUrl() {
    const mediaCandidates = [
      ...Array.from(document.querySelectorAll("video")),
      ...Array.from(document.querySelectorAll("video source")),
      ...Array.from(document.querySelectorAll("source[type^='video/']"))
    ];

    for (const element of mediaCandidates) {
      const raw =
        element.currentSrc ||
        element.src ||
        element.getAttribute("src") ||
        element.getAttribute("data-src") ||
        element.getAttribute("data-video-src");
      if (!raw) continue;

      try {
        const url = new URL(raw, window.location.href).toString();
        if (/\.(mp4|m3u8)(?:$|\?)/i.test(url) || /video/i.test(url)) return url;
      } catch {
        // Ignore malformed URLs.
      }
    }

    const scripts = Array.from(document.scripts).slice(0, 20);
    for (const script of scripts) {
      const text = script.textContent || "";
      const match = text.match(/https?:\/\/[^"'\\\s]+?\.(?:mp4|m3u8)(?:\?[^"'\\\s]*)?/i);
      if (match) return match[0];
    }

    return null;
  }

  function extractDetailDescUrl() {
    const iframe = document.querySelector(
      "iframe[src*='desc.alicdn.com'], iframe[src*='detail.tmall.com'], iframe[src*='imageTextInfo']"
    );
    const iframeSrc = iframe?.getAttribute("src") || iframe?.src;
    if (iframeSrc) {
      const normalized = normalizeImageUrl(iframeSrc);
      if (normalized) return normalized;
    }

    const scripts = Array.from(document.scripts).slice(0, 80);
    const pattern =
      /((?:https?:)?\/\/desc\.alicdn\.com\/[^"'\\\s<>]+|["'](?:https?:)?\/\/desc\.alicdn\.com\/[^"'\\\s<>]+["'])/i;
    for (const script of scripts) {
      const text = script.textContent || "";
      const matched = text.match(pattern);
      if (!matched) continue;

      const raw = matched[1].replace(/^["']|["']$/g, "");
      const withProtocol = raw.startsWith("//") ? `${location.protocol}${raw}` : raw;
      const normalized = normalizeImageUrl(withProtocol);
      if (normalized) return normalized;
    }

    return null;
  }

  function extractImageUrlsFromMarkup(markup) {
    const urls = new Set();
    const normalizedMarkup = [markup, markup.replace(/\\\//g, "/"), markup.replace(/\\u002F/gi, "/")].join("\n");
    const pattern =
      /((?:https?:)?\/\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|gif|bmp|avif)(?:\?[^"'\\\s<>]*)?)/gi;

    let matched;
    while ((matched = pattern.exec(normalizedMarkup))) {
      const raw = matched[1];
      const withProtocol = raw.startsWith("//") ? `${location.protocol}${raw}` : raw;
      const normalized = normalizeImageUrl(withProtocol.replace(/&amp;/g, "&"));
      if (!normalized || isIgnoredImageUrl(normalized) || isLikelyTooSmallDetailImageUrl(normalized)) continue;
      urls.add(normalized);
    }

    return dedupeUrlList(Array.from(urls));
  }

  function collectInlineDetailImageHints() {
    const scriptPayload = Array.from(document.scripts)
      .slice(0, 120)
      .map(script => script.textContent || "")
      .join("\n");
    if (!scriptPayload) return [];
    return extractImageUrlsFromMarkup(scriptPayload);
  }

  async function fetchDetailImagesFromDescApi() {
    const inlineDetailImages = collectInlineDetailImageHints();
    const descUrl = extractDetailDescUrl();
    if (!descUrl) return inlineDetailImages;

    try {
      const response = await fetch(descUrl, {
        credentials: "omit"
      });
      if (!response.ok) return inlineDetailImages;

      const text = await response.text();
      if (!text) return inlineDetailImages;
      return dedupeUrlList([
        ...inlineDetailImages,
        ...extractImageUrlsFromMarkup(text)
      ]);
    } catch {
      return inlineDetailImages;
    }
  }

  async function collectViaDom() {
    await sleep(500);
    await warmUpLazyContent();
    await waitForImageSettle(600);

    const title = getText([
        ".mainTitle",
        '[data-spm="title"]',
        ".ItemHeader--mainTitle--3CIjqW5",
        "h1"
      ]) || document.title;

      const mainSelectors = [
        "#J_UlThumb img",
        "[class*='tb-thumb'] img",
        "[class*='thumbnail'] img",
        "[class*='gallery'] img",
        "[class*='swiper'] img",
        "[class*='mainPic'] img",
        "[class*='main-image'] img"
      ];
      const skuSelectors = [
        "[class*='sku'] img",
        "[class*='Sku'] img",
        "[class*='prop'] img",
        "[class*='spec'] img",
        "[data-sku] img",
        ".J_TSaleProp img"
      ];
      const detailPrimaryContainers = [
        "#description",
        "#J_DivItemDesc",
        "#detail",
        "[class*='descV8']",
        "[class*='detail-content']",
        "[class*='detailContent']",
        "[class*='desc-content']",
        "[class*='descContent']",
        "[data-spm*='detail']",
        "[data-spm*='desc']"
      ];
      const detailFallbackContainers = [
        "[id*='detail']",
        "[class*='detail']",
        "[id*='desc']",
        "[class*='desc']"
      ];
      const detailPrimarySelectors = detailPrimaryContainers.map(selector => `${selector} img`);
      const detailFallbackSelectors = detailFallbackContainers.map(selector => `${selector} img`);

      const mainRegionSelector = getCombinedSelector([
        "#J_UlThumb",
        "[class*='tb-thumb']",
        "[class*='thumbnail']",
        "[class*='gallery']",
        "[class*='swiper']",
        "[class*='mainPic']",
        "[class*='main-image']"
      ]);
      const skuRegionSelector = getCombinedSelector([
        "[class*='sku']",
        "[class*='Sku']",
        "[class*='prop']",
        "[class*='spec']",
        "[data-sku]",
        ".J_TSaleProp"
      ]);
      const detailRegionSelector = getCombinedSelector([
        ...detailPrimaryContainers,
        ...detailFallbackContainers
      ]);
      const detailContentRootSelectors = [
        "#imageTextInfo-content",
        "#imageTextInfo-container",
        ".desc-root",
        ".descV8-container",
        ...detailPrimaryContainers,
        ...detailFallbackContainers
      ];

      const recommendationCutoffTop = getRecommendationCutoffTop();
      const allCandidates = collectAllCandidates(
        mainRegionSelector,
        skuRegionSelector,
        detailRegionSelector,
        recommendationCutoffTop
      );
      const explicitMain = extractBySelectors(mainSelectors, 20, {
        minShortestEdge: 30,
        minArea: 900
      });
      const fallbackMain = explicitMain.length
        ? dedupeCandidates([
            ...explicitMain,
            ...rankByVisualPriority(allCandidates.filter(candidate => candidate.inMainRegion)).slice(0, 30)
          ]).slice(0, 20)
        : rankByVisualPriority(
            allCandidates.filter(
              candidate =>
                !candidate.inSkuRegion &&
                !candidate.inDetailRegion &&
                (candidate.width || 0) >= 240 &&
                (candidate.height || 0) >= 240 &&
                (candidate.top || 0) < window.innerHeight * 1.2
            )
          ).slice(0, 20);
      const skuCandidates = dedupeCandidates([
        ...extractBySelectors(skuSelectors, 50, { extractSku: true }),
        ...rankByVisualPriority(
          allCandidates.filter(
            candidate =>
              candidate.inSkuRegion &&
              !isTooSmallImage(candidate.width || 0, candidate.height || 0, 80, 12000)
          )
        ).slice(0, 40)
      ]).slice(0, 40);

      const primaryDetailCandidates = extractBySelectors(detailPrimarySelectors, 60, {
        predicate: isLikelyDetailImage,
        checkAllDocs: true,
        cutoffTop: recommendationCutoffTop,
        minShortestEdge: 60,
        minArea: 6000
      });
      const fallbackSelectorDetails = extractBySelectors(detailFallbackSelectors, 80, {
        predicate: isLikelyDetailImage,
        checkAllDocs: true,
        cutoffTop: recommendationCutoffTop,
        minTop: window.innerHeight * 0.4,
        minShortestEdge: 60,
        minArea: 6000
      });
      const richDetailCandidates =
        primaryDetailCandidates.length + fallbackSelectorDetails.length >= 8
          ? []
          : extractDetailContainerAssets(
              [...detailPrimaryContainers, ...detailFallbackContainers],
              40,
              {
                predicate: isLikelyStructuredDetailAsset,
                checkAllDocs: true,
                cutoffTop: recommendationCutoffTop,
                minTop: window.innerHeight * 0.45,
                minShortestEdge: 80,
                minArea: 12000
              }
            );

      const structuredDetailContent = collectStructuredDetailContent(detailContentRootSelectors, {
        cutoffTop: recommendationCutoffTop
      });
      const detailCandidates = dedupeCandidates([
        ...primaryDetailCandidates,
        ...fallbackSelectorDetails,
        ...richDetailCandidates,
        ...selectDetailCandidates(allCandidates, [...fallbackMain, ...skuCandidates])
      ]).slice(0, 120);
      const fallbackDetailCandidates = detailCandidates.length
        ? detailCandidates
        : dedupeCandidates(
            excludeKnownProductImages(allCandidates, [...fallbackMain, ...skuCandidates]).filter(candidate => {
              const width = candidate.width || 0;
              const height = candidate.height || 0;
              const area = candidate.area || width * height;
              return (
                candidate.inDetailRegion &&
                Math.max(width, height) >= 220 &&
                Math.min(width, height) >= 100 &&
                area >= 30000
              );
            })
          ).slice(0, 60);

      const mainImages = fallbackMain.map(candidate => candidate.url);
      const colorImages = skuCandidates.map(candidate => candidate.url);
      const detailImages = structuredDetailContent.imageUrls.length
        ? dedupeUrlList(structuredDetailContent.imageUrls)
        : dedupeUrlList([
            ...fallbackDetailCandidates.map(candidate => candidate.url)
          ]);
      const remoteDetailImages = detailImages.length ? [] : await fetchDetailImagesFromDescApi();
      const finalDetailImages = detailImages.length ? detailImages : remoteDetailImages;
      const seenSkus = new Set();
      const skus = skuCandidates
        .filter(candidate => candidate.skuName)
        .map(candidate => ({
          name: candidate.skuName,
          image: candidate.url
        }))
        .filter(item => {
          const key = `${item.name}|${buildDedupeKey(item.image)}`;
          if (seenSkus.has(key)) return false;
          seenSkus.add(key);
          return true;
        });

    return {
      title,
      images: mainImages,
      video_url: getVideoUrl(),
      color_images: colorImages,
      detail_images: finalDetailImages,
      skus,
      raw: {
        detail_root_selector: structuredDetailContent.rootSelector,
        detail_blocks: structuredDetailContent.blocks
      }
    };
  }

  // ---------- 结构化数据通道（主路径） ----------

  function readPageGlobals(timeoutMs = 2500) {
    return new Promise(resolve => {
      const requestId = `tbt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      let settled = false;

      const onMessage = event => {
        if (event.source !== window) return;
        const message = event.data;
        if (!message || message.__TBT_RES__ !== true) return;
        if (message.requestId !== requestId) return;
        window.removeEventListener("message", onMessage);
        settled = true;
        resolve(message.data || null);
      };

      window.addEventListener("message", onMessage);
      window.postMessage({ __TBT_REQ__: true, requestId }, "*");

      window.setTimeout(() => {
        if (settled) return;
        window.removeEventListener("message", onMessage);
        resolve(null);
      }, timeoutMs);
    });
  }

  function asAbsoluteImageUrl(raw) {
    if (typeof raw !== "string") return null;
    let value = raw.trim();
    if (!value) return null;
    if (value.startsWith("//")) value = `${location.protocol}${value}`;
    return normalizeImageUrl(value);
  }

  function pickFirstString(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  }

  function safeGet(obj, path) {
    let cursor = obj;
    for (const key of path) {
      if (cursor == null) return undefined;
      cursor = cursor[key];
    }
    return cursor;
  }

  function readStructuredImageValue(value) {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (typeof value !== "object") return null;

    return (
      value.url ||
      value.pic ||
      value.picUrl ||
      value.pictureUrl ||
      value.image ||
      value.imageUrl ||
      value.img ||
      value.imgUrl ||
      value.src ||
      value.originUrl ||
      value.originalUrl ||
      value.bigPicUrl ||
      value.largePicUrl ||
      null
    );
  }

  function normalizeStructuredImageList(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map(readStructuredImageValue)
      .map(asAbsoluteImageUrl)
      .filter(Boolean)
      .filter(url => !isIgnoredImageUrl(url));
  }

  function collectValuesByKey(root, keyPattern, maxDepth = 8) {
    const values = [];
    const seen = new WeakSet();

    function walk(node, depth) {
      if (!node || typeof node !== "object" || depth > maxDepth || seen.has(node)) return;
      seen.add(node);

      if (Array.isArray(node)) {
        for (const child of node) walk(child, depth + 1);
        return;
      }

      for (const [key, value] of Object.entries(node)) {
        if (keyPattern.test(key)) values.push(value);
        if (value && typeof value === "object") walk(value, depth + 1);
      }
    }

    walk(root, 0);
    return values;
  }

  function extractStructuredTitle(data) {
    return pickFirstString(
      safeGet(data, ["item", "title"]),
      safeGet(data, ["itemDO", "title"]),
      safeGet(data, ["componentsVO", "itemInfoVO", "title"]),
      safeGet(data, ["componentsVO", "headPicViewVO", "title"]),
      safeGet(data, ["data", "item", "title"]),
      data?.title
    );
  }

  function extractStructuredMainImages(data) {
    const directLists = [
      safeGet(data, ["item", "images"]),
      safeGet(data, ["item", "auctionImages"]),
      safeGet(data, ["item", "pics"]),
      safeGet(data, ["item", "picUrls"]),
      safeGet(data, ["itemDO", "images"]),
      safeGet(data, ["itemDO", "auctionImages"]),
      safeGet(data, ["itemInfoModel", "picsPath"]),
      safeGet(data, ["itemInfoModel", "auctionImages"]),
      safeGet(data, ["mainPics"]),
      safeGet(data, ["componentsVO", "headPicViewVO", "picList"]),
      safeGet(data, ["componentsVO", "headPicViewVO", "images"]),
      safeGet(data, ["componentsVO", "mainPicViewVO", "picList"]),
      safeGet(data, ["componentsVO", "mainPicViewVO", "images"]),
      safeGet(data, ["componentsVO", "headImagesViewVO", "picList"]),
      safeGet(data, ["componentsVO", "galleryViewVO", "picList"]),
      safeGet(data, ["data", "item", "images"]),
      safeGet(data, ["detail", "images"])
    ];

    const urls = [];
    for (const list of directLists) {
      urls.push(...normalizeStructuredImageList(list));
    }

    const singleFields = [
      safeGet(data, ["item", "pic"]),
      safeGet(data, ["item", "picUrl"]),
      safeGet(data, ["item", "image"]),
      safeGet(data, ["itemDO", "pic"]),
      safeGet(data, ["itemDO", "picUrl"]),
      safeGet(data, ["itemInfoModel", "mainPic"]),
      safeGet(data, ["componentsVO", "headPicViewVO", "picUrl"])
    ];

    for (const value of singleFields) {
      const url = asAbsoluteImageUrl(readStructuredImageValue(value));
      if (url && !isIgnoredImageUrl(url)) urls.push(url);
    }

    return dedupeUrlList(urls).slice(0, 30);
  }

  function extractStructuredVideoUrl(data) {
    const direct = pickFirstString(
      safeGet(data, ["item", "videoUrl"]),
      safeGet(data, ["item", "video"]),
      safeGet(data, ["itemDO", "videoUrl"]),
      safeGet(data, ["componentsVO", "headPicViewVO", "videoUrl"]),
      safeGet(data, ["componentsVO", "headPicViewVO", "videoUrlV2"]),
      safeGet(data, ["video", "videoUrl"]),
      safeGet(data, ["video", "url"])
    );
    if (direct) return asAbsoluteImageUrl(direct);

    let found = null;
    function walk(node, depth) {
      if (found || depth > 6 || node == null) return;
      if (typeof node === "string") {
        if (/\.(mp4|m3u8)(\?|$)/i.test(node)) found = node;
        return;
      }
      if (Array.isArray(node)) {
        for (const child of node) walk(child, depth + 1);
        return;
      }
      if (typeof node === "object") {
        for (const child of Object.values(node)) walk(child, depth + 1);
      }
    }
    walk(data, 0);
    return found ? asAbsoluteImageUrl(found) : null;
  }

  function extractStructuredSkus(data) {
    const propsContainers = [
      safeGet(data, ["skuBase", "props"]),
      safeGet(data, ["skuBase", "properties"]),
      safeGet(data, ["skuCore", "props"]),
      safeGet(data, ["skuCore", "skuBase", "props"]),
      safeGet(data, ["componentsVO", "skuVO", "skuBase", "props"]),
      safeGet(data, ["componentsVO", "skuVO", "skuBase", "properties"]),
      safeGet(data, ["componentsVO", "saleProp", "props"]),
      safeGet(data, ["props"]),
      safeGet(data, ["propsList"]),
      safeGet(data, ["skuPropertyDOList"])
    ].filter(Array.isArray);

    const collected = [];
    for (const props of propsContainers) {
      for (const prop of props) {
        if (!prop || typeof prop !== "object") continue;
        const propName = pickFirstString(prop.name, prop.propName, prop.title, prop.propertyName) || "";
        const values =
          prop.values ||
          prop.propValues ||
          prop.propertyValueList ||
          prop.valueList ||
          prop.childProperties ||
          [];
        if (!Array.isArray(values)) continue;

        for (const entry of values) {
          if (!entry || typeof entry !== "object") continue;
          const image = asAbsoluteImageUrl(
            readStructuredImageValue(entry) ||
              entry.propertyValuePicture ||
              entry.skuImage ||
              entry.thumb ||
              entry.thumbnail
          );
          const valueName = pickFirstString(
            entry.name,
            entry.text,
            entry.value,
            entry.valueName,
            entry.propertyValueName,
            entry.title
          );
          if (!image || !valueName) continue;
          if (isIgnoredImageUrl(image)) continue;

          const fullName = propName ? `${propName}: ${valueName}` : valueName;
          collected.push({ name: fullName.slice(0, 60), image });
        }
      }
    }

    const propertyPicMaps = [
      safeGet(data, ["propertyPics"]),
      safeGet(data, ["skuBase", "propertyPics"]),
      safeGet(data, ["skuCore", "propertyPics"]),
      safeGet(data, ["skuCore", "sku2info"]),
      safeGet(data, ["sku2info"])
    ].filter(value => value && typeof value === "object");

    for (const picMap of propertyPicMaps) {
      for (const [key, value] of Object.entries(picMap)) {
        const urls = Array.isArray(value)
          ? normalizeStructuredImageList(value)
          : normalizeStructuredImageList([value]);

        for (const image of urls) {
          if (!image || isIgnoredImageUrl(image)) continue;
          const name = String(key).replace(/[;:]+/g, " ").trim() || "SKU";
          collected.push({ name: name.slice(0, 60), image });
        }
      }
    }

    const seen = new Set();
    return collected.filter(item => {
      const key = `${item.name}|${buildDedupeKey(item.image)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function extractStructuredDescUrl(data) {
    const direct = pickFirstString(
      safeGet(data, ["descUrl"]),
      safeGet(data, ["pcDescUrl"]),
      safeGet(data, ["apiItemDesc"]),
      safeGet(data, ["itemDescUrl"]),
      safeGet(data, ["item", "descUrl"]),
      safeGet(data, ["item", "pcDescUrl"]),
      safeGet(data, ["item", "apiItemDesc"]),
      safeGet(data, ["itemDO", "descUrl"]),
      safeGet(data, ["itemDO", "pcDescUrl"]),
      safeGet(data, ["detail", "descUrl"]),
      safeGet(data, ["detail", "pcDescUrl"]),
      safeGet(data, ["descInfo", "pcDescUrl"]),
      safeGet(data, ["descInfo", "descUrl"]),
      safeGet(data, ["descinfo", "urls", "pcDescUrl"]),
      safeGet(data, ["componentsVO", "detailVO", "descUrl"]),
      safeGet(data, ["componentsVO", "detailVO", "pcDescUrl"]),
      safeGet(data, ["componentsVO", "descViewVO", "descUrl"]),
      safeGet(data, ["componentsVO", "descViewVO", "pcDescUrl"]),
      safeGet(data, ["componentsVO", "descViewVO", "url"]),
      safeGet(data, ["api", "descUrl"]),
      safeGet(data, ["api", "pcDescUrl"]),
      safeGet(data, ["taobaoDescUrl"])
    );
    if (direct && /desc\.alicdn\.com/i.test(direct)) return asAbsoluteImageUrl(direct);

    let candidate = null;
    function walk(node, depth) {
      if (candidate || depth > 8 || node == null) return;
      if (typeof node === "string") {
        if (/^(https?:)?\/\/desc\.alicdn\.com\//i.test(node)) candidate = node;
        return;
      }
      if (Array.isArray(node)) {
        for (const child of node) walk(child, depth + 1);
        return;
      }
      if (typeof node === "object") {
        for (const child of Object.values(node)) walk(child, depth + 1);
      }
    }
    walk(data, 0);
    return candidate ? asAbsoluteImageUrl(candidate) : null;
  }

  function unwrapJsonp(text) {
    if (typeof text !== "string") return null;
    const trimmed = text.trim();
    const match = trimmed.match(/^[\w$.]+\(([\s\S]*)\)\s*;?\s*$/);
    if (!match) return null;
    return match[1];
  }

  function extractDetailHtmlFromPayload(payload) {
    if (!payload || typeof payload !== "object") return "";

    const nested = payload.data || payload;
    const candidates = [
      nested?.pcDescContent,
      nested?.mobileDescContent,
      nested?.wdescContent && Array.isArray(nested.wdescContent.pages)
        ? nested.wdescContent.pages.join("\n")
        : null,
      nested?.wdescContent?.singleHtml,
      payload.pcDescContent,
      payload.mobileDescContent,
      Array.isArray(payload.wdescContent?.pages) ? payload.wdescContent.pages.join("\n") : null,
      payload.wdescContent?.singleHtml,
      payload.content,
      nested?.content
    ];

    for (const html of candidates) {
      if (typeof html === "string" && html.length > 0) return html;
    }

    const seen = new WeakSet();
    function walk(node, depth) {
      if (!node || depth > 8) return "";
      if (typeof node === "string") {
        if (/<img\b/i.test(node) || /\/\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|gif|bmp|avif)/i.test(node)) {
          return node;
        }
        try {
          const parsed = JSON.parse(node);
          return walk(parsed, depth + 1);
        } catch {
          return "";
        }
      }
      if (typeof node !== "object" || seen.has(node)) return "";
      seen.add(node);

      if (Array.isArray(node)) {
        for (const child of node) {
          const result = walk(child, depth + 1);
          if (result) return result;
        }
        return "";
      }

      const preferredKeys = [
        "pcDescContent",
        "wdescContent",
        "descContent",
        "description",
        "content",
        "html",
        "pages",
        "singleHtml"
      ];
      for (const key of preferredKeys) {
        const result = walk(node[key], depth + 1);
        if (result) return result;
      }
      for (const child of Object.values(node)) {
        const result = walk(child, depth + 1);
        if (result) return result;
      }
      return "";
    }

    return walk(payload, 0);
  }

  function parseDetailImagesFromHtml(html) {
    if (!html) return [];
    const seen = new Set();
    const urls = [];
    const normalizedHtml = String(html)
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\\u002F/gi, "/")
      .replace(/\\\//g, "/");
    const pattern =
      /<img\b[^>]*?(?:data-ks-lazyload|data-lazyload|data-lazy-src|data-original|data-srcset|srcset|data-src|src)\s*=\s*['"]([^'"<>]+)['"]/gi;

    let matched;
    function push(raw) {
      const url = asAbsoluteImageUrl(raw);
      if (!url) return;
      if (isIgnoredImageUrl(url)) return;
      if (isLikelyTooSmallDetailImageUrl(url)) return;
      const key = buildDedupeKey(url);
      if (seen.has(key)) return;
      seen.add(key);
      urls.push(url);
    }

    while ((matched = pattern.exec(normalizedHtml))) {
      const parts = matched[1]
        .split(",")
        .map(part => part.trim().split(/\s+/)[0])
        .filter(Boolean);
      for (const part of parts) push(part);
    }

    for (const url of extractImageUrlsFromMarkup(normalizedHtml)) {
      if (isLikelyTooSmallDetailImageUrl(url)) continue;
      push(url);
    }

    return urls;
  }

  async function fetchDetailImagesFromDescUrl(descUrl) {
    if (!descUrl) return [];
    try {
      const response = await fetch(descUrl, { credentials: "include" });
      if (!response.ok) return [];
      const text = await response.text();
      if (!text) return [];

      const candidates = [];
      const unwrapped = unwrapJsonp(text);
      if (unwrapped) candidates.push(unwrapped);
      candidates.push(text);

      let html = "";
      for (const body of candidates) {
        try {
          const parsed = JSON.parse(body);
          html = extractDetailHtmlFromPayload(parsed);
          if (html) break;
        } catch {
          // not JSON, try next form
        }
      }

      if (!html) {
        const inlineMatch = text.match(/var\s+desc\s*=\s*['"]([\s\S]+?)['"]\s*;/);
        if (inlineMatch) html = inlineMatch[1].replace(/\\"/g, '"').replace(/\\\//g, "/");
      }

      if (!html) html = text;
      return parseDetailImagesFromHtml(html);
    } catch {
      return [];
    }
  }

  function extractEmbeddedDetailImages(data) {
    if (!data || typeof data !== "object") return [];
    const values = collectValuesByKey(
      data,
      /^(?:pcDescContent|mobileDescContent|wdescContent|descContent|descHtml|descriptionHtml|singleHtml|pages)$/i,
      8
    );

    const htmlParts = [];
    for (const value of values) {
      if (typeof value === "string") {
        htmlParts.push(value);
      } else if (Array.isArray(value)) {
        htmlParts.push(...value.filter(item => typeof item === "string"));
      } else if (value && typeof value === "object") {
        const html = extractDetailHtmlFromPayload(value);
        if (html) htmlParts.push(html);
      }
    }

    return dedupeUrlList(htmlParts.flatMap(parseDetailImagesFromHtml));
  }

  function buildResultFromStructured(productData, detailImages, meta = {}) {
    const title = extractStructuredTitle(productData);
    const mainImages = extractStructuredMainImages(productData);
    const skus = extractStructuredSkus(productData);
    const videoUrl = extractStructuredVideoUrl(productData);
    const colorImages = dedupeUrlList(skus.map(item => item.image).filter(Boolean));

    return {
      title: title || document.title,
      images: mainImages,
      video_url: videoUrl,
      color_images: colorImages,
      detail_images: dedupeUrlList(detailImages),
      skus,
      raw: {
        source: "structured",
        desc_url: meta.descUrl || null,
        page_data_sources: productData?.__tbtSources || productData?.__tbtSource || null,
        counts: {
          main: mainImages.length,
          sku: colorImages.length,
          detail: dedupeUrlList(detailImages).length
        },
        warnings: dedupeUrlList(detailImages).length ? [] : ["structured_detail_images_empty"]
      }
    };
  }

  function isStructuredResultUsable(result) {
    if (!result) return false;
    return Boolean(result.title) && Array.isArray(result.images) && result.images.length > 0;
  }

  function sendCollectResult(data) {
    chrome.runtime.sendMessage(
      { type: "COLLECT_RESULT", taskId, data },
      () => chrome.runtime.sendMessage({ type: "CLOSE_TAB" })
    );
  }

  async function collect() {
    try {
      const productData = await readPageGlobals(2500);

      let detailImages = [];
      let descUrl = null;
      if (productData) {
        descUrl = extractStructuredDescUrl(productData);
        detailImages = extractEmbeddedDetailImages(productData);
        if (descUrl) {
          detailImages = dedupeUrlList([
            ...detailImages,
            ...(await fetchDetailImagesFromDescUrl(descUrl))
          ]);
        }
      }

      const structured = productData
        ? buildResultFromStructured(productData, detailImages, { descUrl })
        : null;

      let finalResult;
      if (isStructuredResultUsable(structured)) {
        finalResult = structured;
      } else {
        const fallback = await collectViaDom();
        finalResult = { ...fallback, raw: { ...(fallback.raw || {}), source: "dom-fallback" } };
      }

      sendCollectResult(finalResult);
    } catch (err) {
      sendCollectResult({ error: err && err.message ? err.message : String(err) });
    }
  }

  collect();
})();
