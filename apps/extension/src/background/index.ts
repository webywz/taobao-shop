import type { GroupType } from "@tb-pdd-image/shared"

import {
  getDeviceId,
  getDeviceToken,
  getInstallationId,
  setDeviceId,
  setDeviceToken
} from "../shared/storage"
import { API_BASE_URL } from "../shared/config"
import { EXTRACTOR_VERSION, EXTENSION_VERSION } from "../shared/version"

const POLL_ALARM_NAME = "task-poll"
const TAB_LOAD_TIMEOUT_MS = 60000
const TASK_EVENTS_RETRY_MS = 5000
let pollInFlight = false
let taskEventsAbortController: AbortController | null = null
let taskEventsConnecting = false

function ensurePollAlarm() {
  chrome.alarms.create(POLL_ALARM_NAME, {
    periodInMinutes: 0.25
  })
}

function isSupportedAppUrl(url: string | undefined) {
  if (!url) {
    return false
  }

  try {
    const parsed = new URL(url)

    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    )
  } catch {
    return false
  }
}

async function refreshSupportedAppTabs() {
  const tabs = await chrome.tabs.query({})

  await Promise.all(
    tabs
      .filter((tab) => tab.id && isSupportedAppUrl(tab.url))
      .map((tab) =>
        chrome.tabs.reload(tab.id as number).catch(() => {
          // Ignore tabs that disappear while reloading.
        })
      )
  )
}

type QueuedTask = {
  taskId: string
  platform: "taobao"
  sourceUrl: string
  taskToken: string
}

type PresignUpload = {
  clientAssetId: string
  assetId: string
  storageKey: string
  method: "PUT"
  uploadUrl: string
  accessUrl?: string
}

type CompleteUpload = {
  assetId: string
  clientAssetId: string
  storageKey: string
  accessUrl?: string
}

type ExtractedAsset = {
  groupType: GroupType
  skuName?: string | null
  sourceUrl: string
  mimeType?: string
  width?: number
  height?: number
  sortOrder: number
}

type ExtractedTaskPayload = {
  title: string | null
  productId: string | null
  canonicalUrl: string
  pageHtml?: string | null
  images: {
    main: ExtractedAsset[]
    sku: ExtractedAsset[]
    detail: ExtractedAsset[]
    other: ExtractedAsset[]
  }
}

type DownloadedAsset = ExtractedAsset & {
  clientAssetId: string
  blob: Blob
  ext: string
  mimeType: string
  originalSourceUrl: string
}

type PollResult = {
  success: boolean
  claimedTaskId?: string
  errorCode?: string
  errorMessage?: string
}

type DeviceEvent = {
  type?: string
  taskId?: string
}

function sleep(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

function getFileExtensionFromMimeType(mimeType: string | undefined) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg"
    case "image/png":
      return "png"
    case "image/webp":
      return "webp"
    case "image/gif":
      return "gif"
    case "image/svg+xml":
      return "svg"
    default:
      return null
  }
}

function getFileExtensionFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname
    const matched = pathname.match(/\.([a-zA-Z0-9]+)$/)
    return matched?.[1]?.toLowerCase() || null
  } catch {
    return null
  }
}

async function assertOk(response: Response, message: string) {
  if (response.ok) {
    return response
  }

  const body = await response.text().catch(() => "")
  throw new Error(body ? `${message}: ${body}` : message)
}

async function uploadPresignedAsset(upload: PresignUpload, asset: DownloadedAsset) {
  const response = await fetch(upload.uploadUrl, {
    method: upload.method,
    headers: {
      "Content-Type": asset.mimeType
    },
    body: asset.blob
  })

  await assertOk(response, `上传文件失败 ${upload.clientAssetId}`)
}

async function markTaskFailed(
  task: QueuedTask,
  deviceToken: string,
  error: unknown,
  errorCode = "UPLOAD_FAILED"
) {
  const errorMessage = error instanceof Error ? error.message : "unknown error"

  await fetch(`${API_BASE_URL}/v1/extract/tasks/${task.taskId}/fail`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deviceToken}`
    },
    body: JSON.stringify({
      taskToken: task.taskToken,
      errorCode,
      errorMessage,
      retryable: true,
      diagnostics: {
        stage: "background-upload"
      }
    })
  })
}

async function createHiddenTab(url: string) {
  return chrome.tabs.create({
    url,
    active: false
  })
}

function buildTaskPageUrl(task: QueuedTask) {
  try {
    const parsed = new URL(task.sourceUrl)
    const productId = parsed.searchParams.get("id")
    const skuId = parsed.searchParams.get("skuId")

    if (productId) {
      const normalized = new URL("https://detail.tmall.com/item.htm")
      normalized.searchParams.set("id", productId)

      if (skuId) {
        normalized.searchParams.set("skuId", skuId)
      }

      return normalized.toString()
    }
  } catch {
    // Fall back to the original task URL if normalization fails.
  }

  return task.sourceUrl
}

async function removeTab(tabId: number | undefined) {
  if (!tabId) {
    return
  }

  try {
    await chrome.tabs.remove(tabId)
  } catch {
    // Ignore cleanup failures for already-closed tabs.
  }
}

async function waitForTabComplete(tabId: number) {
  const existing = await chrome.tabs.get(tabId)

  if (existing.status === "complete") {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated)
      reject(new Error("page load timeout"))
    }, TAB_LOAD_TIMEOUT_MS)

    function onUpdated(updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return
      }

      globalThis.clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      resolve()
    }

    chrome.tabs.onUpdated.addListener(onUpdated)
  })
}

async function extractFromTab(tabId: number) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = (await chrome.tabs.sendMessage(tabId, {
        type: "EXTRACT_PRODUCT_IMAGES",
        payload: {}
      })) as
        | {
            success: true
            payload: ExtractedTaskPayload
          }
        | {
            success: false
            error?: string
          }

      if (!response?.success) {
        throw new Error(response?.error || "content extractor failed")
      }

      return response.payload
    } catch (error) {
      if (attempt === 4) {
        throw error
      }

      await sleep(800)
    }
  }

  throw new Error("extractor unavailable")
}

async function openTaskTab(task: QueuedTask) {
  return {
    tab: await createHiddenTab(buildTaskPageUrl(task)),
    shouldClose: true
  }
}

async function runPageExtraction(task: QueuedTask) {
  const { tab, shouldClose } = await openTaskTab(task)

  try {
    if (!tab.id) {
      throw new Error("failed to create task tab")
    }

    await waitForTabComplete(tab.id)
    await sleep(2500)

    let lastPayload: ExtractedTaskPayload | null = null

    for (let attempt = 0; attempt < 3; attempt += 1) {
      lastPayload = await extractFromTab(tab.id)

      const detailCount = lastPayload.images.detail.length
      const mainCount = lastPayload.images.main.length

      if (detailCount > 0 || attempt === 2 || mainCount === 0) {
        return lastPayload
      }

      await sleep(2500)
    }

    if (!lastPayload) {
      throw new Error("extractor unavailable")
    }

    return lastPayload
  } finally {
    if (shouldClose) {
      await removeTab(tab.id)
    }
  }
}

async function downloadAsset(groupType: ExtractedAsset["groupType"], asset: ExtractedAsset) {
  const response = await fetch(asset.sourceUrl)
  await assertOk(response, `下载原图失败 ${asset.sourceUrl}`)

  const blob = await response.blob()
  const mimeType = response.headers.get("content-type") || blob.type || asset.mimeType || "image/jpeg"
  const ext =
    getFileExtensionFromMimeType(mimeType) || getFileExtensionFromUrl(asset.sourceUrl) || "jpg"

  return {
    ...asset,
    groupType,
    clientAssetId: `${groupType}_${asset.sortOrder}`,
    blob,
    mimeType,
    ext,
    originalSourceUrl: asset.sourceUrl
  } satisfies DownloadedAsset
}

async function collectDownloadedAssets(extracted: ExtractedTaskPayload) {
  const groups = (Object.entries(extracted.images) as Array<
    [ExtractedAsset["groupType"], ExtractedAsset[]]
  >).flatMap(([groupType, assets]) => assets.map((asset) => ({ groupType, asset })))

  const settled = await Promise.allSettled(
    groups.map(({ groupType, asset }) => downloadAsset(groupType, asset))
  )

  return settled
    .filter(
      (
        result
      ): result is PromiseFulfilledResult<DownloadedAsset> => result.status === "fulfilled"
    )
    .map((result) => result.value)
}

async function ensureDeviceRegistered() {
  const existingDeviceId = await getDeviceId()

  if (existingDeviceId) {
    const existingDeviceToken = await getDeviceToken()

    if (existingDeviceToken) {
      void ensureTaskEvents(existingDeviceToken)
    }

    return existingDeviceId
  }

  const installationId = await getInstallationId()

  const response = await fetch(`${API_BASE_URL}/v1/devices/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      installationId,
      browserName: "chrome",
      browserVersion: "dev",
      os: "unknown",
      extensionVersion: EXTENSION_VERSION
    })
  })

  const payload = await response.json()
  await setDeviceId(payload.deviceId)
  await setDeviceToken(payload.deviceToken)
  void ensureTaskEvents(payload.deviceToken)

  return payload.deviceId as string
}

async function executeTask(task: QueuedTask, deviceId: string, deviceToken: string) {
  await assertOk(
    await fetch(`${API_BASE_URL}/v1/extract/tasks/${task.taskId}/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deviceToken}`
      },
      body: JSON.stringify({
        taskToken: task.taskToken
      })
    }),
    "认领任务失败"
  )

  await assertOk(
    await fetch(`${API_BASE_URL}/v1/extract/tasks/${task.taskId}/progress`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deviceToken}`
      },
      body: JSON.stringify({
        taskToken: task.taskToken,
        status: "running",
        stage: "extracting",
        sentAt: new Date().toISOString()
      })
    }),
    "更新运行进度失败"
  )

  await assertOk(
    await fetch(`${API_BASE_URL}/v1/devices/${deviceId}/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deviceToken}`
      },
      body: JSON.stringify({
        currentTaskId: task.taskId,
        taskStatus: "running",
        sentAt: new Date().toISOString()
      })
    }),
    "心跳上报失败"
  )

  const extracted = await runPageExtraction(task)
  const downloadedAssets = await collectDownloadedAssets(extracted)

  if (!downloadedAssets.length) {
    throw new Error("no downloadable product images found")
  }

  const presignResponse = await assertOk(
    await fetch(`${API_BASE_URL}/v1/uploads/presign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deviceToken}`
      },
      body: JSON.stringify({
        taskId: task.taskId,
        files: downloadedAssets.map((asset) => ({
          clientAssetId: asset.clientAssetId,
          groupType: asset.groupType,
          ext: asset.ext,
          mimeType: asset.mimeType
        }))
      })
    }),
    "获取上传签名失败"
  )

  const presignPayload = (await presignResponse.json()) as {
    uploads: PresignUpload[]
  }

  await assertOk(
    await fetch(`${API_BASE_URL}/v1/extract/tasks/${task.taskId}/progress`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deviceToken}`
      },
      body: JSON.stringify({
        taskToken: task.taskToken,
        status: "uploading",
        stage: "uploading-assets",
        sentAt: new Date().toISOString()
      })
    }),
    "更新上传进度失败"
  )

  await Promise.all(
    presignPayload.uploads.map((upload) => {
      const asset = downloadedAssets.find(
        (candidate) => candidate.clientAssetId === upload.clientAssetId
      )

      if (!asset) {
        throw new Error(`missing local asset for ${upload.clientAssetId}`)
      }

      return uploadPresignedAsset(upload, asset)
    })
  )

  const completeResponse = await assertOk(
    await fetch(`${API_BASE_URL}/v1/uploads/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deviceToken}`
      },
      body: JSON.stringify({
        taskId: task.taskId,
        uploads: presignPayload.uploads.map((upload) => ({
          assetId: upload.assetId,
          clientAssetId: upload.clientAssetId,
          storageKey: upload.storageKey
        }))
      })
    }),
    "确认上传结果失败"
  )

  const completePayload = (await completeResponse.json()) as {
    uploads: CompleteUpload[]
  }

  const uploadedByClientAssetId = new Map(
    completePayload.uploads.map((upload) => [upload.clientAssetId, upload] as const)
  )

  const buildUploadedImages = (groupType: ExtractedAsset["groupType"]) =>
    downloadedAssets
      .filter((asset) => asset.groupType === groupType)
      .map((asset) => {
        const uploaded = uploadedByClientAssetId.get(asset.clientAssetId)
        return {
          groupType,
          skuName: asset.skuName ?? null,
          sourceUrl: uploaded?.accessUrl ?? asset.originalSourceUrl,
          sortOrder: asset.sortOrder,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          fileSize: asset.blob.size
        }
      })

  await assertOk(
    await fetch(`${API_BASE_URL}/v1/extract/tasks/${task.taskId}/result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deviceToken}`
      },
      body: JSON.stringify({
        taskToken: task.taskToken,
        title: extracted.title,
        productId: extracted.productId,
        canonicalUrl: extracted.canonicalUrl,
        extractorVersion: EXTRACTOR_VERSION,
        images: {
          main: buildUploadedImages("main"),
          sku: buildUploadedImages("sku"),
          detail: buildUploadedImages("detail"),
          other: buildUploadedImages("other")
        },
        meta: {
          capturedAt: new Date().toISOString()
        }
      })
    }),
    "提交任务结果失败"
  )
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error"
}

async function consumeTaskEvents(deviceToken: string, signal: AbortSignal) {
  const eventsUrl = `${API_BASE_URL}/v1/devices/events?token=${encodeURIComponent(deviceToken)}`
  const response = await fetch(eventsUrl, {
    headers: {
      Accept: "text/event-stream"
    },
    signal
  })

  if (!response.ok || !response.body) {
    throw new Error(`device events unavailable: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (!signal.aborted) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, {
      stream: true
    })

    const chunks = buffer.split("\n\n")
    buffer = chunks.pop() ?? ""

    for (const chunk of chunks) {
      const dataLine = chunk
        .split("\n")
        .find((line) => line.startsWith("data: "))

      if (!dataLine) {
        continue
      }

      const event = JSON.parse(dataLine.slice(6)) as DeviceEvent

      if (event.type === "TASK_CREATED") {
        void pollNextTask()
      }
    }
  }
}

async function ensureTaskEvents(deviceToken: string) {
  if (taskEventsAbortController || taskEventsConnecting) {
    return
  }

  taskEventsConnecting = true
  const controller = new AbortController()
  taskEventsAbortController = controller

  try {
    await consumeTaskEvents(deviceToken, controller.signal)
  } catch (error) {
    if (!controller.signal.aborted) {
      console.warn("device events connection failed", error)
    }
  } finally {
    if (taskEventsAbortController === controller) {
      taskEventsAbortController = null
    }

    taskEventsConnecting = false

    if (!controller.signal.aborted) {
      globalThis.setTimeout(() => {
        void (async () => {
          const latestToken = await getDeviceToken()

          if (latestToken) {
            await ensureTaskEvents(latestToken)
          }
        })()
      }, TASK_EVENTS_RETRY_MS)
    }
  }
}

async function pollNextTask(): Promise<PollResult> {
  if (pollInFlight) {
    return {
      success: true
    }
  }

  pollInFlight = true

  try {
    const deviceId = await ensureDeviceRegistered()
    const deviceToken = await getDeviceToken()

    if (!deviceId || !deviceToken) {
      return {
        success: false,
        errorCode: "DEVICE_NOT_READY",
        errorMessage: "插件设备身份还没有准备好"
      }
    }

    void ensureTaskEvents(deviceToken)

    const response = await fetch(`${API_BASE_URL}/v1/extract/tasks/queue/next`, {
      headers: {
        Authorization: `Bearer ${deviceToken}`
      }
    })

    if (response.status === 204) {
      return {
        success: true
      }
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      return {
        success: false,
        errorCode: "QUEUE_FETCH_FAILED",
        errorMessage: body || `拉取任务失败：${response.status}`
      }
    }

    const task = (await response.json()) as QueuedTask

    try {
      await executeTask(task, deviceId, deviceToken)
      return {
        success: true,
        claimedTaskId: task.taskId
      }
    } catch (error) {
      console.error("task execution failed", error)
      const errorMessage = getErrorMessage(error)
      const errorCode =
        errorMessage === "AUTH_REQUIRED"
          ? "AUTH_REQUIRED"
          : errorMessage === "PRODUCT_NOT_FOUND"
          ? "PRODUCT_NOT_FOUND"
          : errorMessage === "page load timeout"
          ? "PAGE_TIMEOUT"
          : errorMessage === "no downloadable product images found"
            ? "PRODUCT_NOT_FOUND"
            : "UPLOAD_FAILED"

      try {
        await markTaskFailed(task, deviceToken, error, errorCode)
      } catch (failError) {
        console.error("mark task failed request failed", failError)
      }

      return {
        success: false,
        claimedTaskId: task.taskId,
        errorCode,
        errorMessage
      }
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error)
    console.error("poll next task failed", error)

    return {
      success: false,
      errorCode: errorMessage === "Failed to fetch" ? "API_UNREACHABLE" : "POLL_FAILED",
      errorMessage:
        errorMessage === "Failed to fetch"
          ? `无法连接后端服务 ${API_BASE_URL}，请确认 API 已启动`
          : errorMessage
    }
  } finally {
    pollInFlight = false
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensurePollAlarm()
  void refreshSupportedAppTabs()
  void pollNextTask()
})

chrome.runtime.onStartup.addListener(() => {
  ensurePollAlarm()
  void pollNextTask()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM_NAME) {
    void pollNextTask()
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PLUGIN_PING") {
    sendResponse({
      installed: true,
      version: EXTENSION_VERSION
    })
    return true
  }

  if (message?.type === "PLUGIN_STATUS") {
    void (async () => {
      const deviceId = await getDeviceId()
      sendResponse({
        installed: true,
        ready: Boolean(deviceId),
        deviceId
      })
    })()
    return true
  }

  if (message?.type === "TRIGGER_POLL") {
    void (async () => {
      ensurePollAlarm()
      sendResponse(await pollNextTask())
    })()
    return true
  }

  return false
})
