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
  skuOptionId?: string
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

function getDetailImageDimensions(element: HTMLImageElement) {
  const width =
    element.naturalWidth || element.width || getElementDimensionValue(element, "width") || undefined
  const height =
    element.naturalHeight || element.height || getElementDimensionValue(element, "height") || undefined

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

function isIgnoredImageUrlForDetail(sourceUrl: string) {
  return (
    sourceUrl.startsWith("data:") ||
    sourceUrl.startsWith("blob:") ||
    /\/s\.gif(?:$|\?)/i.test(sourceUrl) ||
    /\.(svg)(?:$|\?)/i.test(sourceUrl) ||
    /(sprite|icon|logo|avatar|coupon|badge|qr|qrcode)/i.test(sourceUrl)
  )
}

function isIgnoredImageUrlForSkuColor(sourceUrl: string) {
  return (
    sourceUrl.startsWith("data:") ||
    sourceUrl.startsWith("blob:") ||
    /\/s\.gif(?:$|\?)/i.test(sourceUrl) ||
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

function extractDetailBySelectors(
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

    if (!sourceUrl || isIgnoredImageUrlForDetail(sourceUrl)) {
      continue
    }

    const { width, height } = getDetailImageDimensions(element)

    if ((width ?? 0) < 80 && (height ?? 0) < 80) {
      continue
    }

    const candidate: CandidateImage = {
      sourceUrl,
      width,
      height,
      mimeType: undefined,
      skuName: null
    }

    if (options.predicate && !options.predicate(candidate)) {
      continue
    }

    candidates.push(candidate)
  }

  return dedupeCandidates(candidates).slice(0, limit)
}

function readSkuColorNameFromItem(item: Element) {
  const normalizeName = (value: string | null | undefined) => {
    const normalized = value?.replace(/\s+/g, " ").trim()
    return normalized ? normalized.slice(0, 100) : null
  }

  const labelElement =
    item.querySelector("[class*='valueItemText--']") ||
    item.querySelector("[class*='valueItemText']") ||
    item.querySelector("span[title]") ||
    item.querySelector("span") ||
    item

  const directName = normalizeName(labelElement.getAttribute("title") || labelElement.textContent)
  if (directName) {
    return directName
  }

  const attrCandidates = [
    item.getAttribute("title"),
    item.getAttribute("aria-label"),
    item.getAttribute("data-value"),
    item.getAttribute("data-sku"),
    item.getAttribute("data-name"),
    item.getAttribute("data-label")
  ]

  for (const candidate of attrCandidates) {
    const normalized = normalizeName(candidate)
    if (normalized) {
      return normalized
    }
  }

  const cloned = item.cloneNode(true) as Element
  cloned.querySelectorAll("img, picture, svg, i").forEach((node) => node.remove())
  const textOnly = normalizeName(cloned.textContent)
  if (textOnly) {
    return textOnly
  }

  const vid = item.getAttribute("data-vid")
  return vid ? `SKU-${vid}` : null
}

function isColorSkuSection(container: Element) {
  const label =
    container.querySelector("[class*='ItemLabel'] span") ||
    container.querySelector("[class*='labelWrap'] span[title]") ||
    container.querySelector("[class*='labelWrap'] span")

  const text = (
    label?.getAttribute("title") ||
    label?.textContent ||
    container.getAttribute("data-property-name") ||
    ""
  )
    .replace(/\s+/g, "")
    .trim()

  return text.includes("颜色分类") || text === "颜色" || text.includes("颜色")
}

function isSkuColorPlaceholderUrl(sourceUrl: string) {
  return /-tps-2-2\./i.test(sourceUrl) || /(?:^|[\/_])2x2(?:[._-]|$)/i.test(sourceUrl)
}

function getMainImageCandidate(sourceDocument: Document, baseUrl: string) {
  const mainImageSelectors = [
    "[class*='mainPic'] img",
    "[class*='main-pic'] img",
    "[class*='imgWrap'] img",
    "[class*='preview'] img",
    "#J_ImgBooth",
    "#J_BigImg",
    "[class*='gallery'] img"
  ]

  const images = mainImageSelectors.flatMap((selector) =>
    Array.from(sourceDocument.querySelectorAll(selector)).filter(
      (node): node is HTMLImageElement => node instanceof HTMLImageElement
    )
  )

  let best: CandidateImage | null = null
  let bestArea = 0

  for (const image of images) {
    const rawUrl = collectImageUrlFromElement(image)
    const sourceUrl = rawUrl ? normalizeImageUrl(rawUrl, baseUrl) : null
    if (!sourceUrl || isIgnoredImageUrl(sourceUrl) || isSkuColorPlaceholderUrl(sourceUrl)) {
      continue
    }

    const { width, height } = getImageDimensions(image)
    const area = (width ?? 0) * (height ?? 0)
    if (!best || area > bestArea) {
      best = {
        sourceUrl,
        width,
        height,
        mimeType: undefined,
        skuName: null
      }
      bestArea = area
    }
  }

  return best
}

async function extractSkuColorImages(limit: number, sourceDocument: Document, baseUrl: string): Promise<CandidateImage[]> {
  const sectionSelectors = [
    "#skuOptionsArea [class*='skuItem']",
    "[class*='skuWrapper'] [class*='skuItem']",
    "[class*='skuItem']"
  ]

  const sectionSet = new Set<Element>()
  const orderedSections: Element[] = []

  for (const selector of sectionSelectors) {
    for (const node of Array.from(sourceDocument.querySelectorAll(selector))) {
      if (!sectionSet.has(node)) {
        sectionSet.add(node)
        orderedSections.push(node)
      }
    }
  }

  const colorSections = orderedSections.filter(isColorSkuSection)
  const candidates: CandidateImage[] = []
  const fallbackItems: Array<{
    item: Element
    skuName: string | null
    skuOptionId?: string
  }> = []

  for (const section of colorSections) {
    const items = Array.from(
      section.querySelectorAll(
        "[class*='skuValueWrap'] [class*='valueItem--'], [class*='contentWrap'] [class*='valueItem--'], [class*='skuValueWrap'] div[data-vid]"
      )
    )

    const seenItem = new Set<Element>()
    const orderedItems = items.filter((item) => {
      if (seenItem.has(item)) {
        return false
      }
      seenItem.add(item)
      return true
    })

    const firstEnabledItem = orderedItems.find(
      (item) => item.getAttribute("data-disabled") !== "true"
    )
    if (firstEnabledItem instanceof HTMLElement) {
      // Some Taobao pages keep the first color in an unstable state until toggled twice.
      firstEnabledItem.click()
      await sleep(120)
      firstEnabledItem.click()
      await sleep(120)
    }

    for (const item of orderedItems) {
      const isDisabled = item.getAttribute("data-disabled") === "true"
      if (isDisabled) {
        continue
      }

      const element = item.querySelector("img")
      const skuName = readSkuColorNameFromItem(item)
      const skuOptionId = item.getAttribute("data-vid") || undefined

      if (!(element instanceof HTMLImageElement)) {
        fallbackItems.push({
          item,
          skuName,
          skuOptionId
        })
        continue
      }

      const rawUrl = collectImageUrlFromElement(element)
      const sourceUrl = rawUrl ? normalizeImageUrl(rawUrl, baseUrl) : null

      if (!sourceUrl || isIgnoredImageUrlForSkuColor(sourceUrl)) {
        fallbackItems.push({
          item,
          skuName,
          skuOptionId
        })
        continue
      }

      const { width, height } = getImageDimensions(element)
      const hasKnownSize = (width ?? 0) > 0 || (height ?? 0) > 0

      if (hasKnownSize && (width ?? 0) < 20 && (height ?? 0) < 20) {
        fallbackItems.push({
          item,
          skuName,
          skuOptionId
        })
        continue
      }

      if (isSkuColorPlaceholderUrl(sourceUrl)) {
        fallbackItems.push({
          item,
          skuName,
          skuOptionId
        })
        continue
      }

      candidates.push({
        sourceUrl,
        width,
        height,
        mimeType: undefined,
        skuName,
        skuOptionId
      })
    }
  }

  for (const { item, skuName, skuOptionId } of fallbackItems) {
    ;(item as HTMLElement).click()
    await sleep(120)

    let recovered: CandidateImage | null = null

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const itemImage = item.querySelector("img")
      if (itemImage instanceof HTMLImageElement) {
        const itemRawUrl = collectImageUrlFromElement(itemImage)
        const itemSourceUrl = itemRawUrl ? normalizeImageUrl(itemRawUrl, baseUrl) : null

        if (
          itemSourceUrl &&
          !isIgnoredImageUrlForSkuColor(itemSourceUrl) &&
          !isSkuColorPlaceholderUrl(itemSourceUrl)
        ) {
          const { width, height } = getImageDimensions(itemImage)
          recovered = {
            sourceUrl: itemSourceUrl,
            width,
            height,
            mimeType: undefined,
            skuName,
            skuOptionId
          }
          break
        }
      }

      const mainCandidate = getMainImageCandidate(sourceDocument, baseUrl)
      if (mainCandidate) {
        recovered = {
          ...mainCandidate,
          skuName,
          skuOptionId
        }
        break
      }

      await sleep(100)
    }

    if (recovered) {
      candidates.push(recovered)
    }
  }

  const selected = new Map<string, CandidateImage>()

  for (const candidate of candidates) {
    const skuOptionKey = candidate.skuOptionId?.trim()
    const skuKey = candidate.skuName?.replace(/\s+/g, " ").trim()
    const key = skuOptionKey
      ? `vid:${skuOptionKey}`
      : skuKey && skuKey.length > 0
        ? `sku:${skuKey}`
        : `url:${buildDedupeKey(candidate.sourceUrl)}`

    if (!selected.has(key)) {
      selected.set(key, candidate)
      continue
    }

    const existing = selected.get(key)!
    const existingIsFallbackName = /^SKU-\d+$/i.test(existing.skuName ?? "")
    const nextIsFallbackName = /^SKU-\d+$/i.test(candidate.skuName ?? "")
    const existingArea = (existing.width ?? 0) * (existing.height ?? 0)
    const nextArea = (candidate.width ?? 0) * (candidate.height ?? 0)

    const shouldReplaceByNameQuality =
      existingIsFallbackName && !nextIsFallbackName && (candidate.skuName?.length ?? 0) > 0
    const shouldReplaceByArea =
      nextArea > existingArea && (!nextIsFallbackName || existingIsFallbackName)

    if (shouldReplaceByNameQuality || shouldReplaceByArea) {
      selected.set(key, candidate)
    }
  }

  return Array.from(selected.values()).slice(0, limit)
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
      if (!sourceUrl || isIgnoredImageUrlForDetail(sourceUrl)) {
        continue
      }

      const { width, height } = getDetailImageDimensions(image)
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

  const main = extractBySelectors(mainSelectors, 6, sourceDocument, canonicalUrl, {
    allowUnknownSize: true,
    minEdge: 20
  })
  const sku = await extractSkuColorImages(60, document, canonicalUrl)
  const detailPrimary = extractDetailBySelectors(
    detailPrimarySelectors,
    60,
    sourceDocument,
    canonicalUrl,
    {
      predicate: isLikelyDetailImage
    }
  )
  const detailFallback = extractDetailBySelectors(
    detailFallbackSelectors,
    60,
    sourceDocument,
    canonicalUrl,
    {
      predicate: isLikelyDetailImage
    }
  )
  const detailByTextAnchor = extractDetailImagesByTextAnchor(120, sourceDocument, canonicalUrl)
  const detailCandidates = [...detailByTextAnchor, ...detailPrimary, ...detailFallback]
  const detail = dedupeCandidates(detailCandidates).slice(0, 80)
  const other: CandidateImage[] = []

  const title = sourceDocument.title?.replace(/\s+/g, " ").trim() || null

  return {
    title,
    productId: getProductId(canonicalUrl),
    canonicalUrl,
    pageHtml,
    images: {
      main: toManifestAssets("main", main),
      sku: toManifestAssets("sku", sku),
      detail: toManifestAssets("detail", detail),
      other: toManifestAssets("other", other)
    }
  }
}
