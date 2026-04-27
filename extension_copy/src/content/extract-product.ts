import type { GroupType, ManifestAssetInput } from "@tb-pdd-image/shared"

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
  checkAllDocs?: boolean
  cutoffTop?: number | null
  minTop?: number
  minShortestEdge?: number
  minArea?: number
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

const PLACEHOLDER_IMAGE_PATTERN =
  /(placeholder|blank|empty|default|loading|lazyload|transparent|pixel|spacer|grey|gray|nopic|noimage)/i
const LAZY_PLACEHOLDER_URL_PATTERN =
  /(?:^|\/\/)(?:g\.alicdn\.com\/s\.gif|g\.alicdn\.com\/imgextra\/.+?\/s\.gif|.+\/s\.gif)(?:$|\?)/i
const PLACEHOLDER_ELEMENT_PATTERN =
  /(placeholder|skeleton|loading|lazyload-placeholder|image-placeholder|blank|empty)/i

function getViewportHeight(view: Window = window) {
  return view?.innerHeight || window.innerHeight || 0
}

function getDocumentHeight(doc: Document = document, view: Window = doc.defaultView || window) {
  const body = doc.body
  const root = doc.documentElement

  return Math.max(
    body?.scrollHeight ?? 0,
    body?.offsetHeight ?? 0,
    root?.scrollHeight ?? 0,
    root?.offsetHeight ?? 0,
    root?.clientHeight ?? 0,
    getViewportHeight(view)
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

function getProductId() {
  const url = new URL(window.location.href)
  return url.searchParams.get("id")
}

function collectImageUrlFromElement(element: HTMLImageElement) {
  const deferredSources = [
    element.dataset.src,
    element.dataset.ksLazyload,
    element.getAttribute("data-src"),
    element.getAttribute("data-lazy-src"),
    element.getAttribute("data-ks-lazyload")
  ].filter(Boolean) as string[]

  const immediateSources = [element.currentSrc, element.src].filter(Boolean) as string[]
  const meaningfulImmediateSource = immediateSources.find((source) => !isPlaceholderImageUrl(source))

  if (meaningfulImmediateSource) {
    return meaningfulImmediateSource
  }

  if (deferredSources.length) {
    return deferredSources[0]
  }

  return immediateSources[0] ?? null
}

function isPlaceholderImageUrl(sourceUrl: string | null | undefined) {
  if (!sourceUrl) {
    return true
  }

  return PLACEHOLDER_IMAGE_PATTERN.test(sourceUrl) || LAZY_PLACEHOLDER_URL_PATTERN.test(sourceUrl)
}

function isPlaceholderImageElement(element: HTMLImageElement) {
  const markerText = [
    element.className,
    element.getAttribute("data-name") || "",
    element.getAttribute("data-type") || "",
    element.getAttribute("data-role") || "",
    element.getAttribute("aria-label") || "",
    element.alt || ""
  ].join(" ")

  if (PLACEHOLDER_ELEMENT_PATTERN.test(markerText)) {
    const deferredSource =
      element.dataset.src ||
      element.dataset.ksLazyload ||
      element.getAttribute("data-src") ||
      element.getAttribute("data-lazy-src") ||
      element.getAttribute("data-ks-lazyload")

    if (!deferredSource || isPlaceholderImageUrl(deferredSource)) {
      return true
    }
  }

  const currentLikeSource = element.currentSrc || element.src || ""
  if (isPlaceholderImageUrl(currentLikeSource)) {
    const deferredSource =
      element.dataset.src ||
      element.dataset.ksLazyload ||
      element.getAttribute("data-src") ||
      element.getAttribute("data-lazy-src") ||
      element.getAttribute("data-ks-lazyload")

    if (!deferredSource || isPlaceholderImageUrl(deferredSource)) {
      return true
    }
  }

  const width = element.naturalWidth || element.width || Math.round(element.getBoundingClientRect().width) || 0
  const height = element.naturalHeight || element.height || Math.round(element.getBoundingClientRect().height) || 0
  if (width <= 2 && height <= 2) {
    return true
  }

  return false
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
]

function extractUrlsFromCssValue(value: string | null | undefined) {
  const urls: string[] = []

  if (!value || value === "none") {
    return urls
  }

  const pattern = /url\((['"]?)(.*?)\1\)/gi
  let matched: RegExpExecArray | null

  while ((matched = pattern.exec(value))) {
    if (matched[2]) {
      urls.push(matched[2])
    }
  }

  return urls
}

function collectCandidateUrlsFromElement(element: HTMLElement) {
  const urls = new Set<string>()

  if (element instanceof HTMLImageElement) {
    const directUrl = collectImageUrlFromElement(element)
    if (directUrl) {
      urls.add(directUrl)
    }
  }

  for (const attribute of IMAGE_DATA_ATTRIBUTES) {
    const value = element.getAttribute(attribute)
    if (value) {
      urls.add(value)
    }
  }

  return [...urls]
}

function isIgnoredImageUrl(sourceUrl: string) {
  return (
    sourceUrl.startsWith("data:") ||
    sourceUrl.startsWith("blob:") ||
    /\.(svg)(?:$|\?)/i.test(sourceUrl) ||
    isPlaceholderImageUrl(sourceUrl) ||
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

function normalizeTextContent(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim()
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

function dedupeUrlList(urls: string[]) {
  const seen = new Set<string>()
  const output: string[] = []

  for (const url of urls) {
    const normalized = url ? normalizeImageUrl(url) : null
    if (!normalized || isIgnoredImageUrl(normalized)) {
      continue
    }

    const key = buildDedupeKey(normalized)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    output.push(normalized)
  }

  return output
}

function isTooSmallImage(width: number, height: number, minShortestEdge = 60, minArea = 3600) {
  if (!width || !height) {
    return false
  }

  const shortestEdge = Math.min(width, height)
  const area = width * height
  return shortestEdge < minShortestEdge || area < minArea
}

function parseImageSizeHintFromUrl(sourceUrl: string) {
  if (!sourceUrl) {
    return null
  }

  try {
    const url = new URL(sourceUrl, window.location.href)
    const queryWidth =
      Number(url.searchParams.get("w")) ||
      Number(url.searchParams.get("width")) ||
      Number(url.searchParams.get("imgWidth"))
    const queryHeight =
      Number(url.searchParams.get("h")) ||
      Number(url.searchParams.get("height")) ||
      Number(url.searchParams.get("imgHeight"))

    if (queryWidth > 0 && queryHeight > 0) {
      return {
        width: queryWidth,
        height: queryHeight
      }
    }

    const path = `${url.pathname}${url.search}`
    const matched =
      path.match(/(?:_|-|@)(\d{2,4})x(\d{2,4})(?:[_.-]|$|\?)/i) || path.match(/(\d{2,4})x(\d{2,4})(?=\.)/i)
    if (!matched) {
      return null
    }

    const width = Number(matched[1])
    const height = Number(matched[2])
    if (!width || !height) {
      return null
    }

    return {
      width,
      height
    }
  } catch {
    return null
  }
}

function isLikelyTooSmallDetailImageUrl(sourceUrl: string) {
  const hint = parseImageSizeHintFromUrl(sourceUrl)
  if (!hint) {
    return false
  }

  return isTooSmallImage(hint.width, hint.height, 120, 20000)
}

function isEmptyImageElement(element: HTMLImageElement) {
  const naturalWidth = element.naturalWidth || 0
  const naturalHeight = element.naturalHeight || 0

  if (naturalWidth === 1 && naturalHeight === 1) {
    return true
  }

  if (element.complete && naturalWidth === 0 && naturalHeight === 0) {
    return true
  }

  return false
}

function isLogoLikeElement(element: Element) {
  const logoPattern = /logo/i
  const ownMarkers = [
    element instanceof HTMLImageElement ? element.alt : "",
    element.getAttribute("title") || "",
    element.getAttribute("aria-label") || "",
    element.getAttribute("data-name") || "",
    element.getAttribute("data-title") || "",
    element.id,
    typeof (element as HTMLElement).className === "string" ? (element as HTMLElement).className : ""
  ].join(" ")

  if (logoPattern.test(ownMarkers) || /店铺logo|品牌logo/i.test(ownMarkers)) {
    return true
  }

  let current = element.parentElement
  for (let depth = 0; current && depth < 1; depth += 1, current = current.parentElement) {
    const containerMarkers = [
      current.id,
      typeof current.className === "string" ? current.className : "",
      current.getAttribute("title") || "",
      current.getAttribute("aria-label") || "",
      current.getAttribute("data-name") || "",
      current.getAttribute("data-type") || "",
      current.getAttribute("data-role") || ""
    ].join(" ")

    if (logoPattern.test(containerMarkers) || /店铺logo|品牌logo/i.test(containerMarkers)) {
      return true
    }
  }

  return false
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
]

const TRAILING_SECTION_KEYWORDS = [
  "本店推荐",
  "店铺推荐",
  "推荐商品",
  "猜你喜欢",
  "看了又看",
  "相似推荐"
]

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
].join(", ")

function normalizeSectionText(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, "").toLowerCase()
}

function containsSectionKeyword(value: string | null | undefined, keywords: string[]) {
  const normalized = normalizeSectionText(value)
  return keywords.some((keyword) => normalized.includes(normalizeSectionText(keyword)))
}

function isInExcludedSection(element: Element) {
  if (EXCLUDED_SECTION_SELECTOR && element.closest(EXCLUDED_SECTION_SELECTOR)) {
    return true
  }

  let current: Element | null = element
  for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
    const markerText = [
      current.id,
      typeof (current as HTMLElement).className === "string" ? (current as HTMLElement).className : "",
      current.getAttribute("data-spm") || "",
      current.getAttribute("aria-label") || "",
      current.getAttribute("title") || ""
    ].join(" ")

    if (containsSectionKeyword(markerText, EXCLUDED_SECTION_KEYWORDS)) {
      return true
    }
  }

  return false
}

function getRecommendationCutoffTop() {
  let cutoffTop: number | null = null
  const nodes = Array.from(document.querySelectorAll("h2, h3, h4, strong, [class], [id], [data-spm]")).slice(0, 2000)

  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) {
      continue
    }

    const text = node.innerText || node.textContent || ""
    const compactText = normalizeSectionText(text)
    if (!compactText || compactText.length > 40) {
      continue
    }

    if (!containsSectionKeyword(compactText, TRAILING_SECTION_KEYWORDS)) {
      continue
    }

    if (node.children.length > 8) {
      continue
    }

    const rect = node.getBoundingClientRect()
    const top = window.scrollY + rect.top
    if (top <= window.innerHeight * 1.2) {
      continue
    }

    cutoffTop = cutoffTop === null ? top : Math.min(cutoffTop, top)
  }

  return cutoffTop
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
  const candidates: CandidateImage[] = []
  const docs = options.checkAllDocs ? collectAccessibleDocuments() : [{ doc: document, topOffset: 0, fromIframe: false }]

  for (const { doc, topOffset } of docs) {
    const images = selectors.flatMap((selector) =>
      Array.from(doc.querySelectorAll(selector)).filter(
        (node): node is HTMLImageElement => node instanceof HTMLImageElement
      )
    )

    for (const element of images) {
      if (
        isInExcludedSection(element) ||
        isLogoLikeElement(element) ||
        isEmptyImageElement(element) ||
        isPlaceholderImageElement(element)
      ) {
        continue
      }

      const rect = element.getBoundingClientRect()
      const top = topOffset + rect.top
      if (options.cutoffTop != null && top >= options.cutoffTop) {
        continue
      }

      if (options.minTop != null && top < options.minTop) {
        continue
      }

      const width = element.naturalWidth || Math.round(rect.width) || element.width || undefined
      const height = element.naturalHeight || Math.round(rect.height) || element.height || undefined

      if (isTooSmallImage(width ?? 0, height ?? 0, options.minShortestEdge ?? 60, options.minArea ?? 3600)) {
        continue
      }

      const localSeen = new Set<string>()
      for (const rawUrl of collectCandidateUrlsFromElement(element)) {
        const sourceUrl = rawUrl ? normalizeImageUrl(rawUrl) : null
        if (!sourceUrl || isIgnoredImageUrl(sourceUrl) || localSeen.has(sourceUrl)) {
          continue
        }

        localSeen.add(sourceUrl)
        const candidate: CandidateImage = {
          sourceUrl,
          width,
          height,
          mimeType: undefined,
          skuName: options.skuNameFromElement ? readSkuName(element) : null,
          top,
          area: (width ?? 0) * (height ?? 0)
        }

        if (options.predicate && !options.predicate(candidate)) {
          continue
        }

        candidates.push(candidate)
      }
    }
  }

  return dedupeCandidates(candidates).slice(0, limit)
}

function extractDetailContainerAssets(
  containerSelectors: string[],
  limit: number,
  options: ExtractOptions = {}
): CandidateImage[] {
  const candidates: CandidateImage[] = []
  const docs = options.checkAllDocs ? collectAccessibleDocuments() : [{ doc: document, topOffset: 0, fromIframe: false }]
  const mediaSelector = [
    "img",
    "[data-src]",
    "[data-lazy-src]",
    "[data-ks-lazyload]",
    "[data-bg]",
    "[data-background]",
    "[data-background-image]",
    "[data-origin-src]"
  ].join(", ")

  for (const { doc, topOffset } of docs) {
    const containers = containerSelectors.flatMap((selector) =>
      Array.from(doc.querySelectorAll(selector)).filter((node): node is HTMLElement => node instanceof HTMLElement)
    )
    const elements = new Set<HTMLElement>()

    for (const container of containers) {
      if (container.matches(mediaSelector)) {
        elements.add(container)
      }

      for (const node of Array.from(container.querySelectorAll(mediaSelector))) {
        if (node instanceof HTMLElement) {
          elements.add(node)
        }
      }
    }

    for (const element of elements) {
      if (isInExcludedSection(element) || isLogoLikeElement(element)) {
        continue
      }

      if (
        element instanceof HTMLImageElement &&
        (isEmptyImageElement(element) || isPlaceholderImageElement(element))
      ) {
        continue
      }

      const rect = element.getBoundingClientRect()
      const top = topOffset + rect.top
      if (options.cutoffTop != null && top >= options.cutoffTop) {
        continue
      }

      if (options.minTop != null && top < options.minTop) {
        continue
      }

      const width =
        element instanceof HTMLImageElement
          ? element.naturalWidth || Math.round(rect.width) || element.width || undefined
          : Math.round(rect.width) || undefined
      const height =
        element instanceof HTMLImageElement
          ? element.naturalHeight || Math.round(rect.height) || element.height || undefined
          : Math.round(rect.height) || undefined

      if (
        (!width && !height) ||
        isTooSmallImage(width ?? 0, height ?? 0, options.minShortestEdge ?? 60, options.minArea ?? 3600)
      ) {
        continue
      }

      const localSeen = new Set<string>()
      for (const rawUrl of collectCandidateUrlsFromElement(element)) {
        const sourceUrl = rawUrl ? normalizeImageUrl(rawUrl) : null
        if (!sourceUrl || isIgnoredImageUrl(sourceUrl) || localSeen.has(sourceUrl)) {
          continue
        }

        localSeen.add(sourceUrl)
        const candidate: CandidateImage = {
          sourceUrl,
          width,
          height,
          mimeType: undefined,
          top,
          area: (width ?? 0) * (height ?? 0)
        }

        if (options.predicate && !options.predicate(candidate)) {
          continue
        }

        candidates.push(candidate)
      }
    }
  }

  return dedupeCandidates(candidates).slice(0, limit)
}

function collectStructuredDetailImageNodes(root: HTMLElement) {
  const preferredSelector = [
    "img[data-name='singleImage']",
    "img.descV8-singleImage-image",
    "img[data-name='picJumper']",
    "img.descV8-picJumper-image",
    ".descV8-singleImage img",
    ".descV8-picJumper img",
    "img"
  ].join(", ")

  return Array.from(root.querySelectorAll(preferredSelector)).filter((node): node is HTMLImageElement => {
    if (!(node instanceof HTMLImageElement)) {
      return false
    }

    if (isPlaceholderImageElement(node) || isLogoLikeElement(node)) {
      return false
    }

    const rawUrl = collectImageUrlFromElement(node)
    const sourceUrl = rawUrl ? normalizeImageUrl(rawUrl) : null
    if (!sourceUrl || isIgnoredImageUrl(sourceUrl) || isLikelyTooSmallDetailImageUrl(sourceUrl)) {
      return false
    }

    const rect = node.getBoundingClientRect()
    const width = node.naturalWidth || Math.round(rect.width) || node.width || 0
    const height = node.naturalHeight || Math.round(rect.height) || node.height || 0
    if (isTooSmallImage(width, height, 120, 20000)) {
      return false
    }

    return true
  })
}

function collectStructuredDetailContent(
  rootSelectors: string[],
  options: {
    cutoffTop?: number | null
  } = {}
) {
  let selectedRoot: HTMLElement | null = null
  let selectedTopOffset = 0
  let selectedScore = -1

  for (const { doc, topOffset } of collectAccessibleDocuments()) {
    rootSelectors.forEach((selector, selectorIndex) => {
      const roots = Array.from(doc.querySelectorAll(selector)).filter(
        (node): node is HTMLElement => node instanceof HTMLElement
      )

      for (const root of roots) {
        const imageCount = collectStructuredDetailImageNodes(root).length
        const textLength = normalizeTextContent(root.innerText || root.textContent || "").length
        const priorityBoost = Math.max(0, rootSelectors.length - selectorIndex) * 100000
        const score = priorityBoost + imageCount * 1000 + Math.min(textLength, 2000)

        if (score > selectedScore) {
          selectedRoot = root
          selectedTopOffset = topOffset
          selectedScore = score
        }
      }
    })
  }

  if (!selectedRoot) {
    return {
      imageUrls: [] as string[]
    }
  }

  const imageUrls: string[] = []

  for (const image of collectStructuredDetailImageNodes(selectedRoot)) {
    const rawUrl = collectImageUrlFromElement(image)
    const sourceUrl = rawUrl ? normalizeImageUrl(rawUrl) : null
    if (!sourceUrl || isIgnoredImageUrl(sourceUrl)) {
      continue
    }

    const rect = image.getBoundingClientRect()
    const top = selectedTopOffset + rect.top

    imageUrls.push(sourceUrl)
  }

  return {
    imageUrls: dedupeUrlList(imageUrls)
  }
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
  const candidates: CandidateImage[] = []

  for (const { doc, topOffset, fromIframe } of collectAccessibleDocuments()) {
    for (const element of Array.from(doc.images)) {
      const rawUrl = collectImageUrlFromElement(element)
      const sourceUrl = rawUrl ? normalizeImageUrl(rawUrl) : null

      if (!sourceUrl || isIgnoredImageUrl(sourceUrl)) {
        continue
      }

      const rect = element.getBoundingClientRect()
      const width = element.naturalWidth || Math.round(rect.width) || element.width || undefined
      const height =
        element.naturalHeight || Math.round(rect.height) || element.height || undefined

      if ((width ?? 0) < 60 && (height ?? 0) < 60) {
        continue
      }

      candidates.push({
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
      })
    }
  }

  return candidates
}

function getImageStabilitySnapshot(doc: Document = document) {
  const images = Array.from(doc.images)

  return {
    total: images.length,
    loaded: images.filter((image) => (image.naturalWidth ?? 0) > 0 || (image.naturalHeight ?? 0) > 0)
      .length
  }
}

async function waitForImageSettle(timeoutMs: number, doc: Document = document) {
  const deadline = Date.now() + timeoutMs
  let stableRounds = 0
  let lastSnapshot = getImageStabilitySnapshot(doc)

  while (Date.now() < deadline) {
    await sleep(350)
    const nextSnapshot = getImageStabilitySnapshot(doc)

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

async function warmUpDocument(doc: Document = document, view: Window = doc.defaultView || window) {
  const step = Math.max(Math.round(getViewportHeight(view) * 0.9), 700)
  let currentHeight = getDocumentHeight(doc, view)

  for (let top = 0; top <= currentHeight; top += step) {
    view.scrollTo({
      top,
      behavior: "instant"
    })
    await waitForImageSettle(700, doc)
    currentHeight = Math.max(currentHeight, getDocumentHeight(doc, view))
  }

  view.scrollTo({
    top: currentHeight,
    behavior: "instant"
  })
  await waitForImageSettle(900, doc)

  view.scrollTo({
    top: 0,
    behavior: "instant"
  })
  await waitForImageSettle(500, doc)
}

async function warmUpLazyContent() {
  await warmUpDocument(document, window)
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

  if (longestEdge < 240) {
    return false
  }

  if (shortestEdge < 80) {
    return false
  }

  if (area < 20000) {
    return false
  }

  return true
}

function isLikelyStructuredDetailAsset(candidate: CandidateImage) {
  const width = candidate.width ?? 0
  const height = candidate.height ?? 0

  if (!width || !height) {
    return true
  }

  const shortestEdge = Math.min(width, height)
  const longestEdge = Math.max(width, height)
  const area = width * height

  if (longestEdge < 180) {
    return false
  }

  if (shortestEdge < 60) {
    return false
  }

  if (area < 12000) {
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
      const belowFold = (candidate.top ?? 0) > window.innerHeight * 0.55

      if (!candidate.inDetailRegion && !belowFold) {
        return false
      }

      if (longestEdge < 240) {
        return false
      }

      if (shortestEdge < 80) {
        return false
      }

      if (area < 20000) {
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

function extractDetailDescUrl() {
  const iframe = document.querySelector(
    "iframe[src*='desc.alicdn.com'], iframe[src*='detail.tmall.com'], iframe[src*='imageTextInfo']"
  )
  const iframeSrc = iframe?.getAttribute("src") || (iframe as HTMLIFrameElement | null)?.src
  if (iframeSrc) {
    const normalized = normalizeImageUrl(iframeSrc)
    if (normalized) {
      return normalized
    }
  }

  const scripts = Array.from(document.scripts).slice(0, 80)
  const pattern =
    /((?:https?:)?\/\/desc\.alicdn\.com\/[^"'\\\s<>]+|["'](?:https?:)?\/\/desc\.alicdn\.com\/[^"'\\\s<>]+["'])/i
  for (const script of scripts) {
    const text = script.textContent || ""
    const matched = text.match(pattern)
    if (!matched) {
      continue
    }

    const raw = matched[1].replace(/^["']|["']$/g, "")
    const withProtocol = raw.startsWith("//") ? `${location.protocol}${raw}` : raw
    const normalized = normalizeImageUrl(withProtocol)
    if (normalized) {
      return normalized
    }
  }

  return null
}

function extractImageUrlsFromMarkup(markup: string) {
  const urls = new Set<string>()
  const normalizedMarkup = [markup, markup.replace(/\\\//g, "/"), markup.replace(/\\u002F/gi, "/")].join("\n")
  const pattern =
    /((?:https?:)?\/\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|gif|bmp|avif)(?:\?[^"'\\\s<>]*)?)/gi

  let matched: RegExpExecArray | null
  while ((matched = pattern.exec(normalizedMarkup))) {
    const raw = matched[1]
    const withProtocol = raw.startsWith("//") ? `${location.protocol}${raw}` : raw
    const normalized = normalizeImageUrl(withProtocol.replace(/&amp;/g, "&"))
    if (!normalized || isIgnoredImageUrl(normalized) || isLikelyTooSmallDetailImageUrl(normalized)) {
      continue
    }

    urls.add(normalized)
  }

  return dedupeUrlList([...urls])
}

function collectInlineDetailImageHints() {
  const scriptPayload = Array.from(document.scripts)
    .slice(0, 120)
    .map((script) => script.textContent || "")
    .join("\n")

  if (!scriptPayload) {
    return []
  }

  return extractImageUrlsFromMarkup(scriptPayload)
}

async function fetchDetailImagesFromDescApi() {
  const inlineDetailImages = collectInlineDetailImageHints()
  const descUrl = extractDetailDescUrl()
  if (!descUrl) {
    return inlineDetailImages
  }

  try {
    const response = await fetch(descUrl, {
      credentials: "omit"
    })
    if (!response.ok) {
      return inlineDetailImages
    }

    const text = await response.text()
    if (!text) {
      return inlineDetailImages
    }

    return dedupeUrlList([...inlineDetailImages, ...extractImageUrlsFromMarkup(text)])
  } catch {
    return inlineDetailImages
  }
}

export async function extractProductFromPage(): Promise<ExtractedProduct> {
  await sleep(500)
  await warmUpLazyContent()
  await waitForImageSettle(600)

  const mainSelectors = [
    "#J_UlThumb img",
    "[class*='tb-thumb'] img",
    "[class*='thumbnail'] img",
    "[class*='gallery'] img",
    "[class*='swiper'] img"
  ]

  const skuSelectors = [
    "[class*='sku'] img",
    "[class*='Sku'] img",
    "[class*='prop'] img",
    "[class*='spec'] img",
    "[data-sku] img"
  ]

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
  ]

  const detailFallbackContainers = [
    "[id*='detail']",
    "[class*='detail']",
    "[id*='desc']",
    "[class*='desc']"
  ]

  const detailPrimarySelectors = detailPrimaryContainers.map((selector) => `${selector} img`)
  const detailFallbackSelectors = detailFallbackContainers.map((selector) => `${selector} img`)

  const mainRegionSelector = getCombinedSelector([
    "#J_UlThumb",
    "[class*='tb-thumb']",
    "[class*='thumbnail']",
    "[class*='gallery']",
    "[class*='swiper']"
  ])
  const skuRegionSelector = getCombinedSelector([
    "[class*='sku']",
    "[class*='Sku']",
    "[class*='prop']",
    "[class*='spec']",
    "[data-sku]"
  ])
  const detailRegionSelector = getCombinedSelector([
    ...detailPrimaryContainers,
    ...detailFallbackContainers
  ])

  const structuredCandidates: CandidateImage[] = []
  const structuredMain = structuredCandidates.filter((candidate) => candidate.inMainRegion)
  const structuredSku = structuredCandidates.filter((candidate) => candidate.inSkuRegion)
  const structuredDetail = structuredCandidates.filter((candidate) => candidate.inDetailRegion)
  const structuredOther = structuredCandidates.filter(
    (candidate) => !candidate.inMainRegion && !candidate.inSkuRegion && !candidate.inDetailRegion
  )

  const main = dedupeCandidates([...extractBySelectors(mainSelectors, 12), ...structuredMain]).slice(0, 12)
  const recommendationCutoffTop = getRecommendationCutoffTop()
  const allCandidates = collectAllCandidates(mainRegionSelector, skuRegionSelector, detailRegionSelector).filter(
    (candidate) => recommendationCutoffTop == null || (candidate.top ?? 0) < recommendationCutoffTop
  )
  const sku = dedupeCandidates([
    ...extractBySelectors(skuSelectors, 60, {
      skuNameFromElement: true
    }),
    ...structuredSku,
    ...rankByVisualPriority(
      allCandidates.filter(
        (candidate) =>
          candidate.inSkuRegion &&
          (candidate.width ?? 0) >= 40 &&
          (candidate.height ?? 0) >= 40
      )
    ).slice(0, 40)
  ]).slice(0, 40)
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
    predicate: isLikelyDetailImage,
    checkAllDocs: true,
    cutoffTop: recommendationCutoffTop,
    minShortestEdge: 60,
    minArea: 6000
  })
  const detailFallback = extractBySelectors(detailFallbackSelectors, 60, {
    predicate: isLikelyDetailImage,
    checkAllDocs: true,
    cutoffTop: recommendationCutoffTop,
    minTop: window.innerHeight * 0.4,
    minShortestEdge: 60,
    minArea: 6000
  })
  const richDetail =
    detailPrimary.length + detailFallback.length >= 8
      ? []
      : extractDetailContainerAssets([...detailPrimaryContainers, ...detailFallbackContainers], 40, {
          predicate: isLikelyStructuredDetailAsset,
          checkAllDocs: true,
          cutoffTop: recommendationCutoffTop,
          minTop: window.innerHeight * 0.45,
          minShortestEdge: 80,
          minArea: 12000
        })
  const structuredDetailContent = collectStructuredDetailContent(
    ["#imageTextInfo-content", "#imageTextInfo-container", ".desc-root", ".descV8-container", ...detailPrimaryContainers, ...detailFallbackContainers],
    {
      cutoffTop: recommendationCutoffTop
    }
  )
  const detailCandidates =
    detailPrimary.length || detailFallback.length || richDetail.length || structuredDetail.length
      ? [
          ...detailPrimary,
          ...detailFallback,
          ...richDetail,
          ...structuredDetail,
          ...selectDetailCandidates(allCandidates, [...fallbackMain, ...sku])
        ]
      : selectDetailCandidates(allCandidates, [...fallbackMain, ...sku])
  const detail = structuredDetailContent.imageUrls.length
    ? dedupeCandidates(
        structuredDetailContent.imageUrls.map((sourceUrl) => ({
          sourceUrl
        }))
      ).slice(0, 200)
    : dedupeCandidates(detailCandidates).slice(0, 120)
  const remoteDetail =
    detail.length > 0
      ? []
      : (await fetchDetailImagesFromDescApi()).map((sourceUrl) => ({
          sourceUrl
        }))
  const finalDetail = detail.length > 0 ? detail : dedupeCandidates(remoteDetail).slice(0, 200)
  const other = dedupeCandidates([
    ...selectOtherCandidates(allCandidates, [...fallbackMain, ...sku, ...finalDetail]),
    ...structuredOther
  ]).slice(0, 200)

  const title = document.title?.replace(/\s+/g, " ").trim() || null

  return {
    title,
    productId: getProductId(),
    canonicalUrl: window.location.href,
    images: {
      main: toManifestAssets("main", fallbackMain),
      sku: toManifestAssets("sku", sku),
      detail: toManifestAssets("detail", finalDetail),
      other: toManifestAssets("other", other)
    }
  }
}
