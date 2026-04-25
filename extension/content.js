(function () {
  const taskId = new URLSearchParams(location.search).get("__task_id");
  if (!taskId) return;

  function sleep(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  function getText(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = el?.innerText?.replace(/\s+/g, " ").trim();
      if (text) return text;
    }
    return null;
  }

  function getDocumentHeight(doc = document) {
    const body = doc.body;
    const root = doc.documentElement;
    return Math.max(
      body?.scrollHeight || 0,
      body?.offsetHeight || 0,
      root?.scrollHeight || 0,
      root?.offsetHeight || 0,
      root?.clientHeight || 0,
      window.innerHeight
    );
  }

  function getImageStabilitySnapshot() {
    const images = Array.from(document.images);
    return {
      total: images.length,
      loaded: images.filter(image => (image.naturalWidth || 0) > 0 || (image.naturalHeight || 0) > 0).length
    };
  }

  async function waitForImageSettle(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let stableRounds = 0;
    let lastSnapshot = getImageStabilitySnapshot();

    while (Date.now() < deadline) {
      await sleep(350);
      const nextSnapshot = getImageStabilitySnapshot();

      if (nextSnapshot.total === lastSnapshot.total && nextSnapshot.loaded === lastSnapshot.loaded) {
        stableRounds += 1;
        if (stableRounds >= 2) return;
      } else {
        stableRounds = 0;
        lastSnapshot = nextSnapshot;
      }
    }
  }

  async function warmUpLazyContent() {
    const step = Math.max(Math.round(window.innerHeight * 0.9), 700);
    let currentHeight = getDocumentHeight();

    for (let top = 0; top <= currentHeight; top += step) {
      window.scrollTo({ top, behavior: "instant" });
      await waitForImageSettle(1400);
      currentHeight = Math.max(currentHeight, getDocumentHeight());
    }

    window.scrollTo({ top: currentHeight, behavior: "instant" });
    await waitForImageSettle(1800);

    window.scrollTo({ top: 0, behavior: "instant" });
    await waitForImageSettle(1200);
  }

  function collectImageUrlFromElement(element) {
    return (
      element.currentSrc ||
      element.src ||
      element.dataset.src ||
      element.dataset.ksLazyload ||
      element.getAttribute("data-src") ||
      element.getAttribute("data-lazy-src") ||
      element.getAttribute("data-ks-lazyload")
    );
  }

  function isIgnoredImageUrl(sourceUrl) {
    if (!sourceUrl) return true;
    return (
      sourceUrl.startsWith("data:") ||
      sourceUrl.startsWith("blob:") ||
      /\.(svg)(?:$|\?)/i.test(sourceUrl) ||
      /(sprite|icon|logo|avatar|coupon|badge|qr|qrcode)/i.test(sourceUrl)
    );
  }

  function normalizeImageUrl(rawUrl) {
    try {
      let urlStr = rawUrl
        .replace(/_[0-9]+x[0-9]+(?:q[0-9]+)?(?:s[0-9]+)?(?:_[a-z0-9]+)?(?=\.(?:jpg|jpeg|png|webp)|$)/gi, "")
        .replace(/\.avif(?:_\.webp)?(?=$|\?)/i, "");
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

  function buildDedupeKey(sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      return `${url.origin}${url.pathname}`;
    } catch {
      return sourceUrl;
    }
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
        if (isInExcludedSection(element)) continue;

        const rawUrl = collectImageUrlFromElement(element);
        const url = rawUrl ? normalizeImageUrl(rawUrl) : null;
        if (!url || isIgnoredImageUrl(url)) continue;

        const rect = element.getBoundingClientRect();
        const top = topOffset + rect.top;
        if (options.cutoffTop != null && top >= options.cutoffTop) continue;

        const width = element.naturalWidth || element.width || undefined;
        const height = element.naturalHeight || element.height || undefined;
        if ((width || 0) < 80 && (height || 0) < 80) continue;

        const candidate = {
          url,
          width,
          height,
          top,
          area: (width || 0) * (height || 0),
          skuName: options.extractSku ? readSkuName(element) : null
        };

        if (options.predicate && !options.predicate(candidate)) continue;
        candidates.push(candidate);
      }
    }

    return dedupeCandidates(candidates).slice(0, limit);
  }

  function collectAllCandidates(mainRegionSelector, skuRegionSelector, detailRegionSelector, cutoffTop) {
    const candidates = [];

    for (const { doc, topOffset, fromIframe } of collectAccessibleDocuments()) {
      for (const element of Array.from(doc.images)) {
        if (isInExcludedSection(element)) continue;

        const rawUrl = collectImageUrlFromElement(element);
        const url = rawUrl ? normalizeImageUrl(rawUrl) : null;
        if (!url || isIgnoredImageUrl(url)) continue;

        const rect = element.getBoundingClientRect();
        const top = topOffset + rect.top;
        if (cutoffTop != null && top >= cutoffTop) continue;

        const width = element.naturalWidth || Math.round(rect.width) || element.width || undefined;
        const height = element.naturalHeight || Math.round(rect.height) || element.height || undefined;
        if ((width || 0) < 60 && (height || 0) < 60) continue;

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

    if (longestEdge < 260) return false;
    if (shortestEdge < 120) return false;
    if (area < 45000) return false;
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
        const belowFold = (candidate.top || 0) > window.innerHeight * 0.7;

        if (!candidate.inDetailRegion && !belowFold) return false;
        if (longestEdge < 260) return false;
        if (shortestEdge < 120) return false;
        if (area < 45000) return false;

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

  async function collect() {
    try {
      await sleep(1500);
      await warmUpLazyContent();
      await waitForImageSettle(1500);

      const title = getText([
        ".mainTitle",
        '[data-spm="title"]',
        ".ItemHeader--mainTitle--3CIjqW5",
        "h1"
      ]) || document.title;
      const priceText = getText([
        ".priceText",
        ".tb-rmb-num",
        ".Price--priceText--2nLbVda",
        '[class*="price"]'
      ]);
      const shopName = getText([
        ".shopName",
        ".shop-name-title",
        ".ShopHeader--title--1z66K_f",
        '[class*="shop-name"]'
      ]);

      const mainSelectors = [
        "#J_UlThumb img",
        "[class*='tb-thumb'] img",
        "[class*='thumbnail'] img",
        "[class*='gallery'] img",
        "[class*='swiper'] img",
        "[class*='mainPic'] img",
        "[class*='main-image'] img"
      ];
      const detailPrimarySelectors = [
        "#description img",
        "#J_DivItemDesc img",
        "[class*='descV8'] img",
        "[class*='detail-content'] img",
        "[class*='detailContent'] img",
        "[data-spm*='detail'] img"
      ];
      const detailFallbackSelectors = [
        "[id*='detail'] img",
        "[class*='detail'] img",
        "[class*='desc'] img"
      ];

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
        ...detailPrimarySelectors.map(selector => selector.replace(/\s+img$/, "")),
        ...detailFallbackSelectors.map(selector => selector.replace(/\s+img$/, ""))
      ]);

      const recommendationCutoffTop = getRecommendationCutoffTop();
      const allCandidates = collectAllCandidates(
        mainRegionSelector,
        skuRegionSelector,
        detailRegionSelector,
        recommendationCutoffTop
      );
      const explicitMain = extractBySelectors(mainSelectors, 12);
      const fallbackMain = explicitMain.length
        ? dedupeCandidates([
            ...explicitMain,
            ...rankByVisualPriority(allCandidates.filter(candidate => candidate.inMainRegion)).slice(0, 20)
          ]).slice(0, 12)
        : rankByVisualPriority(
            allCandidates.filter(
              candidate =>
                !candidate.inSkuRegion &&
                !candidate.inDetailRegion &&
                (candidate.width || 0) >= 240 &&
                (candidate.height || 0) >= 240 &&
                (candidate.top || 0) < window.innerHeight * 1.2
            )
          ).slice(0, 12);

      const detailCandidates = dedupeCandidates([
        ...extractBySelectors(detailPrimarySelectors, 60, {
          predicate: isLikelyDetailImage,
          checkAllDocs: true,
          cutoffTop: recommendationCutoffTop
        }),
        ...extractBySelectors(detailFallbackSelectors, 60, {
          predicate: isLikelyDetailImage,
          checkAllDocs: true,
          cutoffTop: recommendationCutoffTop
        }),
        ...selectDetailCandidates(allCandidates, [...fallbackMain])
      ]).slice(0, 30);
      const fallbackDetailCandidates = detailCandidates.length
        ? detailCandidates
        : dedupeCandidates(
            excludeKnownProductImages(allCandidates, [...fallbackMain]).filter(candidate => {
              const width = candidate.width || 0;
              const height = candidate.height || 0;
              const area = candidate.area || width * height;
              return (
                (candidate.inDetailRegion || (candidate.top || 0) > window.innerHeight * 0.8) &&
                Math.max(width, height) >= 220 &&
                Math.min(width, height) >= 100 &&
                area >= 30000
              );
            })
          ).slice(0, 30);

      const mainImages = fallbackMain.map(candidate => candidate.url);
      const detailImages = fallbackDetailCandidates
        .map(candidate => candidate.url)
        .filter(url => !mainImages.includes(url));

      const result = {
        title,
        price_text: priceText,
        shop_name: shopName,
        images: mainImages,
        video_url: getVideoUrl(),
        color_images: [],
        detail_images: detailImages,
        skus: []
      };

      chrome.runtime.sendMessage(
        { type: "COLLECT_RESULT", taskId, data: result },
        () => chrome.runtime.sendMessage({ type: "CLOSE_TAB" })
      );
    } catch (err) {
      chrome.runtime.sendMessage(
        { type: "COLLECT_RESULT", taskId, data: { error: err.message } },
        () => chrome.runtime.sendMessage({ type: "CLOSE_TAB" })
      );
    }
  }

  collect();
})();
