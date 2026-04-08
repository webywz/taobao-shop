import type { GroupType, ManifestAssetInput, Platform } from "@tb-pdd-image/shared"

type ExtractedProduct = {
  title: string | null
  productId: string | null
  canonicalUrl: string
  images: Record<GroupType, ManifestAssetInput[]>
}

type CandidateImage = {
  sourceUrl: string
  width?: number
  height?: number
  mimeType?: string
  skuName?: string | null
  top?: number
  area?: number
  inMainRegion?: boolean
  inSkuRegion?: boolean
  inDetailRegion?: boolean
  fromIframe?: boolean
}

type ExtractOptions = {
  skuNameFromElement?: boolean
  predicate?: (candidate: CandidateImage) => boolean
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function getDocumentHeight(doc: Document = document) {
  const body = doc.body
  const root = doc.documentElement

  return Math.max(
    body?.scrollHeight ?? 0,
    body?.offsetHeight ?? 0,
    root?.scrollHeight ?? 0,
    root?.offsetHeight ?? 0,
    root?.clientHeight ?? 0,
    window.innerHeight
  )
}

function normalizeImageUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl, window.location.href)
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function getProductId(platform: Platform) {
  const url = new URL(window.location.href)

  if (platform === "taobao") {
    return url.searchParams.get("id")
  }

  return (
    url.searchParams.get("goods_id") ||
    url.searchParams.get("goodsId") ||
    url.pathname.match(/goods(?:_detail)?\/(\d+)/)?.[1] ||
    null
  )
}

function collectImageUrlFromElement(element: HTMLImageElement) {
  return (
    element.currentSrc ||
    element.src ||
    element.dataset.src ||
    element.dataset.ksLazyload ||
    element.getAttribute("data-src") ||
    element.getAttribute("data-lazy-src") ||
    element.getAttribute("data-ks-lazyload")
  )
}

function isIgnoredImageUrl(sourceUrl: string) {
  return (
    sourceUrl.startsWith("data:") ||
    sourceUrl.startsWith("blob:") ||
    /\.(svg)(?:$|\?)/i.test(sourceUrl) ||
    /(sprite|icon|logo|avatar|coupon|badge|qr|qrcode)/i.test(sourceUrl)
  )
}

function toManifestAssets(groupType: GroupType, candidates: CandidateImage[]): ManifestAssetInput[] {
  return candidates.map((candidate, index) => ({
    groupType,
    skuName: candidate.skuName ?? null,
    sourceUrl: candidate.sourceUrl,
    mimeType: candidate.mimeType ?? undefined,
    width: candidate.width,
    height: candidate.height,
    sortOrder: index + 1
  }))
}

function readSkuName(element: HTMLImageElement) {
  const namedContainer = element.closest("[data-value], [data-sku], li, button, label, div")

  if (!namedContainer) {
    return null
  }

  const rawName =
    namedContainer.getAttribute("title") ||
    namedContainer.getAttribute("aria-label") ||
    namedContainer.getAttribute("data-value") ||
    namedContainer.getAttribute("data-sku") ||
    namedContainer.textContent

  const normalized = rawName?.replace(/\s+/g, " ").trim()
  return normalized ? normalized.slice(0, 60) : null
}

function dedupeCandidates(candidates: CandidateImage[]) {
  const seen = new Set<string>()

  return candidates.filter((candidate) => {
    const dedupeKey = (() => {
      try {
        const url = new URL(candidate.sourceUrl)
        return `${url.origin}${url.pathname}`
      } catch {
        return candidate.sourceUrl
      }
    })()

    if (seen.has(dedupeKey)) {
      return false
    }

    seen.add(dedupeKey)
    return true
  })
}

function buildDedupeKey(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl)
    return `${url.origin}${url.pathname}`
  } catch {
    return sourceUrl
  }
}

function getCombinedSelector(selectors: string[]) {
  return selectors.join(", ")
}

function matchesRegion(element: HTMLImageElement, selector: string) {
  if (!selector) {
    return false
  }

  try {
    return Boolean(element.closest(selector))
  } catch {
    return false
  }
}

function extractBySelectors(
  selectors: string[],
  limit: number,
  options: ExtractOptions = {}
): CandidateImage[] {
  const images = selectors.flatMap((selector) =>
    Array.from(document.querySelectorAll(selector)).filter(
      (node): node is HTMLImageElement => node instanceof HTMLImageElement
    )
  )

  const candidates = images
    .map((element) => {
      const rawUrl = collectImageUrlFromElement(element)
      const sourceUrl = rawUrl ? normalizeImageUrl(rawUrl) : null

      if (!sourceUrl || isIgnoredImageUrl(sourceUrl)) {
        return null
      }

      const width = element.naturalWidth || element.width || undefined
      const height = element.naturalHeight || element.height || undefined

      if ((width ?? 0) < 80 && (height ?? 0) < 80) {
        return null
      }

      const candidate = {
        sourceUrl,
        width,
        height,
        mimeType: undefined,
        skuName: options.skuNameFromElement ? readSkuName(element) : null
      } satisfies CandidateImage

      if (options.predicate && !options.predicate(candidate)) {
        return null
      }

      return candidate
    })
    .filter((candidate): candidate is CandidateImage => candidate !== null)

  return dedupeCandidates(candidates).slice(0, limit)
}

function extractFallbackMainImages(limit: number) {
  const images = Array.from(document.images)
    .map((element) => {
      const rawUrl = collectImageUrlFromElement(element)
      const sourceUrl = rawUrl ? normalizeImageUrl(rawUrl) : null

      if (!sourceUrl || isIgnoredImageUrl(sourceUrl)) {
        return null
      }

      const rect = element.getBoundingClientRect()
      const width = element.naturalWidth || element.width || Math.round(rect.width) || undefined
      const height = element.naturalHeight || element.height || Math.round(rect.height) || undefined

      if ((width ?? 0) < 240 || (height ?? 0) < 240) {
        return null
      }

      return {
        sourceUrl,
        width,
        height,
        score: (width ?? 0) * (height ?? 0),
        top: rect.top
      }
    })
    .filter(
      (
        candidate
      ): candidate is CandidateImage & {
        score: number
        top: number
      } => candidate !== null
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return left.top - right.top
    })

  return dedupeCandidates(images).slice(0, limit)
}

function collectAccessibleDocuments() {
  const documents: Array<{
    doc: Document
    topOffset: number
    fromIframe: boolean
  }> = []

  const visited = new Set<Document>()

  function visit(doc: Document, topOffset: number, fromIframe: boolean) {
    if (visited.has(doc)) {
      return
    }

    visited.add(doc)
    documents.push({
      doc,
      topOffset,
      fromIframe
    })

    const iframes = Array.from(doc.querySelectorAll("iframe"))

    for (const iframe of iframes) {
      try {
        const nestedDocument = iframe.contentDocument

        if (!nestedDocument) {
          continue
        }

        const rect = iframe.getBoundingClientRect()
        visit(nestedDocument, topOffset + rect.top, true)
      } catch {
        // Ignore cross-origin frames.
      }
    }
  }

  visit(document, 0, false)
  return documents
}

function collectAllCandidates(
  mainRegionSelector: string,
  skuRegionSelector: string,
  detailRegionSelector: string
) {
  return collectAccessibleDocuments()
    .flatMap(({ doc, topOffset, fromIframe }) =>
      Array.from(doc.images).map((element) => {
        const rawUrl = collectImageUrlFromElement(element)
        const sourceUrl = rawUrl ? normalizeImageUrl(rawUrl) : null

        if (!sourceUrl || isIgnoredImageUrl(sourceUrl)) {
          return null
        }

        const rect = element.getBoundingClientRect()
        const width = element.naturalWidth || Math.round(rect.width) || element.width || undefined
        const height =
          element.naturalHeight || Math.round(rect.height) || element.height || undefined

        if ((width ?? 0) < 60 && (height ?? 0) < 60) {
          return null
        }

        return {
          sourceUrl,
          width,
          height,
          mimeType: undefined,
          skuName: matchesRegion(element, skuRegionSelector) ? readSkuName(element) : null,
          top: topOffset + rect.top,
          area: (width ?? 0) * (height ?? 0),
          inMainRegion: matchesRegion(element, mainRegionSelector),
          inSkuRegion: matchesRegion(element, skuRegionSelector),
          inDetailRegion: fromIframe || matchesRegion(element, detailRegionSelector),
          fromIframe
        } satisfies CandidateImage
      })
    )
    .filter((candidate): candidate is CandidateImage => candidate !== null)
}

function getImageStabilitySnapshot() {
  const images = Array.from(document.images)

  return {
    total: images.length,
    loaded: images.filter((image) => (image.naturalWidth ?? 0) > 0 || (image.naturalHeight ?? 0) > 0)
      .length
  }
}

async function waitForImageSettle(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  let stableRounds = 0
  let lastSnapshot = getImageStabilitySnapshot()

  while (Date.now() < deadline) {
    await sleep(350)
    const nextSnapshot = getImageStabilitySnapshot()

    if (
      nextSnapshot.total === lastSnapshot.total &&
      nextSnapshot.loaded === lastSnapshot.loaded
    ) {
      stableRounds += 1

      if (stableRounds >= 2) {
        return
      }
    } else {
      stableRounds = 0
      lastSnapshot = nextSnapshot
    }
  }
}

async function warmUpLazyContent() {
  const step = Math.max(Math.round(window.innerHeight * 0.9), 700)
  let currentHeight = getDocumentHeight()

  for (let top = 0; top <= currentHeight; top += step) {
    window.scrollTo({
      top,
      behavior: "instant"
    })
    await waitForImageSettle(1400)
    currentHeight = Math.max(currentHeight, getDocumentHeight())
  }

  window.scrollTo({
    top: currentHeight,
    behavior: "instant"
  })
  await waitForImageSettle(1800)

  window.scrollTo({
    top: 0,
    behavior: "instant"
  })
  await waitForImageSettle(1200)
}

function isLikelyDetailImage(candidate: CandidateImage) {
  const width = candidate.width ?? 0
  const height = candidate.height ?? 0

  if (!width || !height) {
    return true
  }

  const shortestEdge = Math.min(width, height)
  const longestEdge = Math.max(width, height)
  const area = width * height

  if (longestEdge < 320) {
    return false
  }

  if (shortestEdge < 120) {
    return false
  }

  if (area < 50000) {
    return false
  }

  return true
}

function excludeKnownProductImages(
  candidates: CandidateImage[],
  excludedCandidates: CandidateImage[]
) {
  const excludedKeys = new Set(excludedCandidates.map((candidate) => buildDedupeKey(candidate.sourceUrl)))

  return candidates.filter((candidate) => !excludedKeys.has(buildDedupeKey(candidate.sourceUrl)))
}

function rankByVisualPriority(candidates: CandidateImage[]) {
  return [...candidates].sort((left, right) => {
    const leftArea = left.area ?? ((left.width ?? 0) * (left.height ?? 0))
    const rightArea = right.area ?? ((right.width ?? 0) * (right.height ?? 0))

    if (rightArea !== leftArea) {
      return rightArea - leftArea
    }

    return (left.top ?? 0) - (right.top ?? 0)
  })
}

function selectDetailCandidates(
  allCandidates: CandidateImage[],
  excludedCandidates: CandidateImage[]
) {
  const seen = new Set<string>()

  return excludeKnownProductImages(allCandidates, excludedCandidates)
    .filter((candidate) => {
      const width = candidate.width ?? 0
      const height = candidate.height ?? 0
      const shortestEdge = Math.min(width, height)
      const longestEdge = Math.max(width, height)
      const area = candidate.area ?? width * height
      const belowFold = (candidate.top ?? 0) > window.innerHeight * 0.7

      if (!candidate.inDetailRegion && !belowFold) {
        return false
      }

      if (longestEdge < 360) {
        return false
      }

      if (shortestEdge < 220) {
        return false
      }

      if (area < 90000) {
        return false
      }

      const dedupeKey = buildDedupeKey(candidate.sourceUrl)

      if (seen.has(dedupeKey)) {
        return false
      }

      seen.add(dedupeKey)
      return true
    })
    .sort((left, right) => {
      const leftPrimaryScore =
        (left.inDetailRegion ? 1000 : 0) +
        (left.fromIframe ? 400 : 0) +
        ((left.top ?? 0) > window.innerHeight ? 200 : 0)
      const rightPrimaryScore =
        (right.inDetailRegion ? 1000 : 0) +
        (right.fromIframe ? 400 : 0) +
        ((right.top ?? 0) > window.innerHeight ? 200 : 0)

      if (rightPrimaryScore !== leftPrimaryScore) {
        return rightPrimaryScore - leftPrimaryScore
      }

      const rightArea = right.area ?? ((right.width ?? 0) * (right.height ?? 0))
      const leftArea = left.area ?? ((left.width ?? 0) * (left.height ?? 0))

      if (rightArea !== leftArea) {
        return rightArea - leftArea
      }

      return (left.top ?? 0) - (right.top ?? 0)
    })
    .slice(0, 30)
}

function selectOtherCandidates(
  allCandidates: CandidateImage[],
  excludedCandidates: CandidateImage[]
) {
  return dedupeCandidates(excludeKnownProductImages(allCandidates, excludedCandidates))
    .filter((candidate) => {
      const width = candidate.width ?? 0
      const height = candidate.height ?? 0
      const area = candidate.area ?? width * height

      if (area < 3600) {
        return false
      }

      if (width < 60 && height < 60) {
        return false
      }

      return true
    })
    .sort((left, right) => {
      const leftContextScore =
        (left.inDetailRegion ? 300 : 0) + (left.inMainRegion ? 150 : 0) + (left.inSkuRegion ? 100 : 0)
      const rightContextScore =
        (right.inDetailRegion ? 300 : 0) +
        (right.inMainRegion ? 150 : 0) +
        (right.inSkuRegion ? 100 : 0)

      if (rightContextScore !== leftContextScore) {
        return rightContextScore - leftContextScore
      }

      if ((left.top ?? 0) !== (right.top ?? 0)) {
        return (left.top ?? 0) - (right.top ?? 0)
      }

      return (right.area ?? 0) - (left.area ?? 0)
    })
    .slice(0, 200)
}

export async function extractProductFromPage(platform: Platform): Promise<ExtractedProduct> {
  await warmUpLazyContent()

  const mainSelectors =
    platform === "taobao"
      ? [
          "#J_UlThumb img",
          "[class*='tb-thumb'] img",
          "[class*='thumbnail'] img",
          "[class*='gallery'] img",
          "[class*='swiper'] img"
        ]
      : [
          "[class*='goods-gallery'] img",
          "[class*='goods-detail'] img",
          "[class*='swiper'] img",
          "[class*='thumbnail'] img"
        ]

  const skuSelectors = [
    "[class*='sku'] img",
    "[class*='Sku'] img",
    "[class*='prop'] img",
    "[class*='spec'] img",
    "[data-sku] img"
  ]

  const detailPrimarySelectors =
    platform === "taobao"
      ? [
          "#description img",
          "#J_DivItemDesc img",
          "[class*='descV8'] img",
          "[class*='detail-content'] img",
          "[class*='detailContent'] img",
          "[data-spm*='detail'] img"
        ]
      : [
          "[class*='goods-detail'] img",
          "[class*='detail-gallery'] img",
          "[class*='goods-desc'] img",
          "[class*='detail-content'] img"
        ]

  const detailFallbackSelectors = [
    "[id*='detail'] img",
    "[class*='detail'] img",
    "[class*='desc'] img"
  ]

  const mainRegionSelector = getCombinedSelector(
    platform === "taobao"
      ? ["#J_UlThumb", "[class*='tb-thumb']", "[class*='thumbnail']", "[class*='gallery']", "[class*='swiper']"]
      : ["[class*='goods-gallery']", "[class*='swiper']", "[class*='thumbnail']"]
  )
  const skuRegionSelector = getCombinedSelector([
    "[class*='sku']",
    "[class*='Sku']",
    "[class*='prop']",
    "[class*='spec']",
    "[data-sku]"
  ])
  const detailRegionSelector = getCombinedSelector([
    ...detailPrimarySelectors.map((selector) => selector.replace(/\s+img$/, "")),
    ...detailFallbackSelectors.map((selector) => selector.replace(/\s+img$/, ""))
  ])

  const main = extractBySelectors(mainSelectors, 12)
  const allCandidates = collectAllCandidates(mainRegionSelector, skuRegionSelector, detailRegionSelector)
  const fallbackSku: CandidateImage[] = []
  const fallbackMain = main.length
    ? main
    : rankByVisualPriority(
        allCandidates.filter(
          (candidate) =>
            !candidate.inSkuRegion &&
            !candidate.inDetailRegion &&
            (candidate.width ?? 0) >= 240 &&
            (candidate.height ?? 0) >= 240 &&
            (candidate.top ?? 0) < window.innerHeight * 1.2
        )
      ).slice(0, 12)
  const detailPrimary = extractBySelectors(detailPrimarySelectors, 60, {
    predicate: isLikelyDetailImage
  })
  const detailFallback = extractBySelectors(detailFallbackSelectors, 60, {
    predicate: isLikelyDetailImage
  })
  const detailCandidates =
    detailPrimary.length || detailFallback.length
      ? [
          ...detailPrimary,
          ...detailFallback,
          ...selectDetailCandidates(allCandidates, fallbackMain)
        ]
      : selectDetailCandidates(allCandidates, fallbackMain)
  const detail = dedupeCandidates(detailCandidates).slice(0, 30)
  const other = selectOtherCandidates(allCandidates, [...fallbackMain, ...detail])

  const title = document.title?.replace(/\s+/g, " ").trim() || null

  return {
    title,
    productId: getProductId(platform),
    canonicalUrl: window.location.href,
    images: {
      main: toManifestAssets("main", fallbackMain),
      sku: [],
      detail: toManifestAssets("detail", detail),
      other: toManifestAssets("other", other)
    }
  }
}
