import type { GroupType, ManifestAssetInput } from "@tb-pdd-image/shared"

type ExtractedProduct = {
  title: string | null
  productId: string | null
  canonicalUrl: string
  pageHtml: string | null
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
  allowUnknownSize?: boolean
  minEdge?: number
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

function normalizeImageUrl(rawUrl: string, baseUrl: string) {
  try {
    const url = new URL(rawUrl, baseUrl)
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function getProductId(canonicalUrl: string) {
  const url = new URL(canonicalUrl)
  return url.searchParams.get("id")
}

function collectImageUrlFromElement(element: HTMLImageElement) {
  const lazyUrl =
    element.dataset.src ||
    element.dataset.ksLazyload ||
    element.getAttribute("data-src") ||
    element.getAttribute("data-lazy-src") ||
    element.getAttribute("data-ks-lazyload")

  return (
    lazyUrl ||
    element.currentSrc ||
    element.src ||
    null
  )
}

function getElementDimensionValue(
  element: HTMLImageElement,
  attrName: "width" | "height"
) {
  const attrValue = element.getAttribute(attrName)

  if (!attrValue) {
    return undefined
  }

  const parsed = Number.parseInt(attrValue, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function getStyleDimensionValue(
  element: HTMLImageElement,
  attrName: "width" | "height"
) {
  const styleValue = element.style?.[attrName]

  if (!styleValue) {
    return undefined
  }

  const parsed = Number.parseFloat(styleValue)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined
}

function getImageDimensions(element: HTMLImageElement) {
  const width =
    element.naturalWidth ||
    element.width ||
    getElementDimensionValue(element, "width") ||
    getStyleDimensionValue(element, "width") ||
    undefined
  const height =
    element.naturalHeight ||
    element.height ||
    getElementDimensionValue(element, "height") ||
    getStyleDimensionValue(element, "height") ||
    undefined

  return {
    width,
    height
  }
}

function isIgnoredImageUrl(sourceUrl: string) {
  return (
    sourceUrl.startsWith("data:") ||
    sourceUrl.startsWith("blob:") ||
    /\/s\.gif(?:$|\?)/i.test(sourceUrl) ||
    /-tps-2-2\./i.test(sourceUrl) ||
    /(?:^|[\/_])2x2(?:[._-]|$)/i.test(sourceUrl) ||
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
  const selected = new Map<
    string,
    {
      candidate: CandidateImage
      firstIndex: number
    }
  >()

  function getCandidateArea(candidate: CandidateImage) {
    return candidate.area ?? ((candidate.width ?? 0) * (candidate.height ?? 0))
  }

  function isBetterCandidate(next: CandidateImage, current: CandidateImage) {
    const nextArea = getCandidateArea(next)
    const currentArea = getCandidateArea(current)

    if (nextArea !== currentArea) {
      return nextArea > currentArea
    }

    const nextLongest = Math.max(next.width ?? 0, next.height ?? 0)
    const currentLongest = Math.max(current.width ?? 0, current.height ?? 0)

    if (nextLongest !== currentLongest) {
      return nextLongest > currentLongest
    }

    return (next.skuName?.length ?? 0) > (current.skuName?.length ?? 0)
  }

  candidates.forEach((candidate, index) => {
    const dedupeKey = buildDedupeKey(candidate.sourceUrl)
    const existing = selected.get(dedupeKey)

    if (!existing) {
      selected.set(dedupeKey, {
        candidate,
        firstIndex: index
      })
      return
    }

    if (isBetterCandidate(candidate, existing.candidate)) {
      selected.set(dedupeKey, {
        candidate,
        firstIndex: existing.firstIndex
      })
    }
  })

  return [...selected.values()]
    .sort((left, right) => left.firstIndex - right.firstIndex)
    .map((item) => item.candidate)
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

function parseSnapshotDocument(pageHtml: string) {
  try {
    return new DOMParser().parseFromString(pageHtml, "text/html")
  } catch {
    return null
  }
}

function extractBySelectors(
  selectors: string[],
  limit: number,
  sourceDocument: Document,
  baseUrl: string,
  options: ExtractOptions = {}
): CandidateImage[] {
  const images = selectors.flatMap((selector) =>
    Array.from(sourceDocument.querySelectorAll(selector)).filter(
      (node): node is HTMLImageElement => node instanceof HTMLImageElement
    )
  )
  const candidates: CandidateImage[] = []

  for (const element of images) {
    const rawUrl = collectImageUrlFromElement(element)
    const sourceUrl = rawUrl ? normalizeImageUrl(rawUrl, baseUrl) : null

    if (!sourceUrl || isIgnoredImageUrl(sourceUrl)) {
      continue
    }

    const { width, height } = getImageDimensions(element)
    const hasKnownSize = (width ?? 0) > 0 || (height ?? 0) > 0
    const minEdge = options.minEdge ?? 80

    if (hasKnownSize && (width ?? 0) < minEdge && (height ?? 0) < minEdge) {
      continue
    }

    if (!hasKnownSize && !options.allowUnknownSize) {
      continue
    }

    const candidate: CandidateImage = {
      sourceUrl,
      width,
      height,
      mimeType: undefined,
      skuName: options.skuNameFromElement ? readSkuName(element) : null
    }

    if (options.predicate && !options.predicate(candidate)) {
      continue
    }

    candidates.push(candidate)
  }

  return dedupeCandidates(candidates).slice(0, limit)
}

function collectAllCandidatesFromSnapshot(
  sourceDocument: Document,
  mainRegionSelector: string,
  skuRegionSelector: string,
  detailRegionSelector: string,
  baseUrl: string
) {
  const candidates: CandidateImage[] = []

  Array.from(sourceDocument.images).forEach((element, index) => {
    const rawUrl = collectImageUrlFromElement(element)
    const sourceUrl = rawUrl ? normalizeImageUrl(rawUrl, baseUrl) : null

    if (!sourceUrl || isIgnoredImageUrl(sourceUrl)) {
      return
    }

    const { width, height } = getImageDimensions(element)
    const hasKnownSize = (width ?? 0) > 0 || (height ?? 0) > 0

    if (hasKnownSize && (width ?? 0) < 60 && (height ?? 0) < 60) {
      return
    }

    candidates.push({
      sourceUrl,
      width,
      height,
      mimeType: undefined,
      skuName: matchesRegion(element, skuRegionSelector) ? readSkuName(element) : null,
      top: index,
      area: (width ?? 0) * (height ?? 0),
      inMainRegion: matchesRegion(element, mainRegionSelector),
      inSkuRegion: matchesRegion(element, skuRegionSelector),
      inDetailRegion: matchesRegion(element, detailRegionSelector),
      fromIframe: false
    })
  })

  return candidates
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

function extractDetailImagesByTextAnchor(limit: number, sourceDocument: Document, baseUrl: string) {
  const keywords = ["图文详情", "商品详情", "宝贝详情"]
  const titleElements = Array.from(
    sourceDocument.querySelectorAll("p, span, div, h1, h2, h3, h4, h5, h6")
  ).filter((element) => {
    const text = element.textContent?.replace(/\s+/g, "").trim() ?? ""
    return keywords.some((keyword) => text === keyword || text.includes(keyword))
  })

  const candidates: CandidateImage[] = []

  for (const titleElement of titleElements) {
    const detailContainer =
      titleElement.closest("[class*='tabDetailItem']") ||
      titleElement.parentElement?.querySelector("#imageTextInfo-content")?.parentElement ||
      titleElement.parentElement

    if (!detailContainer) {
      continue
    }

    const targetImages = Array.from(
      detailContainer.querySelectorAll(
        "#imageTextInfo-content img, #imageTextInfo-container img, .descV8-container img, img[data-name='singleImage']"
      )
    ).filter((node): node is HTMLImageElement => node instanceof HTMLImageElement)

    for (const image of targetImages) {
      const rawUrl = collectImageUrlFromElement(image)
      const sourceUrl = rawUrl ? normalizeImageUrl(rawUrl, baseUrl) : null
      if (!sourceUrl || isIgnoredImageUrl(sourceUrl)) {
        continue
      }

      const { width, height } = getImageDimensions(image)
      const candidate: CandidateImage = {
        sourceUrl,
        width,
        height,
        mimeType: undefined,
        skuName: null
      }

      if (!isLikelyDetailImage(candidate)) {
        continue
      }

      candidates.push(candidate)
    }
  }

  return dedupeCandidates(candidates).slice(0, limit)
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

export async function extractProductFromPage(): Promise<ExtractedProduct> {
  await warmUpLazyContent()
  const canonicalUrl = window.location.href
  const pageHtml = document.documentElement?.outerHTML ?? null
  const snapshotDocument = pageHtml ? parseSnapshotDocument(pageHtml) : null
  const sourceDocument = snapshotDocument ?? document

  const mainSelectors = [
    "[class*='thumbnailsWrap'] [class*='thumbnailPic']",
    "[class*='thumbnails'] [class*='thumbnailPic']",
    "[class*='thumbnailItem'] [class*='thumbnailPic']",
    "[class*='thumbnail'] [class*='thumbnailPic']",
    "#J_UlThumb img",
    "[class*='mainPic'] img",
    "[class*='main-pic'] img",
    "[class*='tb-thumb'] img",
    "[class*='thumbnail'] img",
    "[class*='gallery'] img",
    "[class*='swiper'] img",
    "[class*='carousel'] img"
  ]

  const skuSelectors = [
    "#skuOptionsArea [class*='valueItemImgWrap'] img",
    "#skuOptionsArea [class*='valueItem'] img",
    "#skuOptionsArea img",
    "[id*='skuOptions'] [class*='valueItemImgWrap'] img",
    "[id*='skuOptions'] [class*='valueItem'] img"
  ]

  const detailPrimarySelectors = [
    "#description img",
    "#J_DivItemDesc img",
    "[class*='descV8'] img",
    "[class*='detail-content'] img",
    "[class*='detailContent'] img",
    "[data-spm*='detail'] img"
  ]

  const detailFallbackSelectors = [
    "[id*='detail'] img",
    "[class*='detail'] img",
    "[class*='desc'] img"
  ]

  const mainRegionSelector = getCombinedSelector([
    "[class*='thumbnailsWrap']",
    "[class*='thumbnails']",
    "[class*='thumbnailItem']",
    "[class*='thumbnail']",
    "#J_UlThumb",
    "[class*='mainPic']",
    "[class*='main-pic']",
    "[class*='tb-thumb']",
    "[class*='thumbnail']",
    "[class*='gallery']",
    "[class*='swiper']",
    "[class*='carousel']"
  ])
  const skuRegionSelector = getCombinedSelector([
    "#skuOptionsArea",
    "[id*='skuOptions']",
    "[class*='skuWrapper'] [class*='skuValueWrap']",
    "[class*='skuWrapper'] [class*='valueItem']",
    "[class*='skuValueWrap'] [class*='valueItem']"
  ])
  const detailRegionSelector = getCombinedSelector([
    ...detailPrimarySelectors.map((selector) => selector.replace(/\s+img$/, "")),
    ...detailFallbackSelectors.map((selector) => selector.replace(/\s+img$/, ""))
  ])

  const structuredCandidates: CandidateImage[] = []
  const structuredMain = structuredCandidates.filter((candidate) => candidate.inMainRegion)
  const structuredSku = structuredCandidates.filter((candidate) => candidate.inSkuRegion)
  const structuredDetail = structuredCandidates.filter((candidate) => candidate.inDetailRegion)
  const structuredOther = structuredCandidates.filter(
    (candidate) => !candidate.inMainRegion && !candidate.inSkuRegion && !candidate.inDetailRegion
  )

  const main = dedupeCandidates([
    ...extractBySelectors(mainSelectors, 20, sourceDocument, canonicalUrl, {
      allowUnknownSize: true,
      minEdge: 20
    }),
    ...structuredMain
  ]).slice(0, 6)
  const allCandidates = collectAllCandidatesFromSnapshot(
    sourceDocument,
    mainRegionSelector,
    skuRegionSelector,
    detailRegionSelector,
    canonicalUrl
  )
  const sku = dedupeCandidates([
    ...extractBySelectors(skuSelectors, 60, sourceDocument, canonicalUrl, {
      skuNameFromElement: true,
      allowUnknownSize: true,
      minEdge: 40
    }),
    ...structuredSku,
    ...rankByVisualPriority(
      allCandidates.filter(
        (candidate) => {
          if (!candidate.inSkuRegion) {
            return false
          }

          const width = candidate.width ?? 0
          const height = candidate.height ?? 0
          const hasKnownSize = width > 0 || height > 0

          if (hasKnownSize && width < 20 && height < 20) {
            return false
          }

          return true
        }
      )
    ).slice(0, 40)
  ]).slice(0, 40)
  const fallbackMain = main.length
    ? main
    : rankByVisualPriority(
        allCandidates.filter(
          (candidate) =>
            candidate.inMainRegion &&
            !candidate.inSkuRegion &&
            !candidate.inDetailRegion &&
            (candidate.width ?? 0) >= 240 &&
            (candidate.height ?? 0) >= 240 &&
            (candidate.top ?? 0) < 120
        )
      ).slice(0, 6)
  const detailPrimary = extractBySelectors(
    detailPrimarySelectors,
    60,
    sourceDocument,
    canonicalUrl,
    {
      predicate: isLikelyDetailImage
    }
  )
  const detailFallback = extractBySelectors(
    detailFallbackSelectors,
    60,
    sourceDocument,
    canonicalUrl,
    {
      predicate: isLikelyDetailImage
    }
  )
  const detailByTextAnchor = extractDetailImagesByTextAnchor(120, sourceDocument, canonicalUrl)
  const detailCandidates =
    detailPrimary.length || detailFallback.length || detailByTextAnchor.length || structuredDetail.length
      ? [
          ...detailByTextAnchor,
          ...detailPrimary,
          ...detailFallback,
          ...structuredDetail,
          ...selectDetailCandidates(allCandidates, [...fallbackMain, ...sku])
        ]
      : selectDetailCandidates(allCandidates, [...fallbackMain, ...sku])
  const detail = dedupeCandidates(detailCandidates).slice(0, 80)
  const other = dedupeCandidates([
    ...selectOtherCandidates(allCandidates, [...fallbackMain, ...sku, ...detail]),
    ...structuredOther
  ]).slice(0, 200)

  const title = sourceDocument.title?.replace(/\s+/g, " ").trim() || null

  return {
    title,
    productId: getProductId(canonicalUrl),
    canonicalUrl,
    pageHtml,
    images: {
      main: toManifestAssets("main", fallbackMain),
      sku: toManifestAssets("sku", sku),
      detail: toManifestAssets("detail", detail),
      other: toManifestAssets("other", other)
    }
  }
}
