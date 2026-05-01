import type { GroupType } from "@tb-pdd-image/shared"

import {
  DEFAULT_MAX_CONCURRENT_TASKS,
  MAX_MAX_CONCURRENT_TASKS,
  MIN_MAX_CONCURRENT_TASKS,
  getDeviceId,
  getDeviceToken,
  getInstallationId,
  getMaxConcurrentTasks,
  setDeviceId,
  setDeviceToken,
  setMaxConcurrentTasks
} from "../shared/storage"
import { API_BASE_URL } from "../shared/config"
import { EXTRACTOR_VERSION, EXTENSION_VERSION } from "../shared/version"

const POLL_ALARM_NAME = "task-poll"
const TAB_LOAD_TIMEOUT_MS = 60000
const TASK_EVENTS_RETRY_MS = 5000
const activeTaskIds = new Set<string>()
let queuePumpInFlight = false
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

async function assertOk(response: Response, message: string) {
  if (response.ok) {
    return response
  }

  const body = await response.text().catch(() => "")
  throw new Error(body ? `${message}: ${body}` : message)
}

async function markTaskFailed(
  task: QueuedTask,
  deviceToken: string,
  error: unknown,
  errorCode = "INTERNAL_ERROR"
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
        stage: "background-extract"
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
  const extractedAssetCount = Object.values(extracted.images).reduce(
    (count, assets) => count + assets.length,
    0
  )

  if (!extractedAssetCount) {
    throw new Error("no product image urls found")
  }

  const buildExtractedImages = (groupType: ExtractedAsset["groupType"]) =>
    extracted.images[groupType]
      .map((asset) => {
        return {
          groupType,
          skuName: asset.skuName ?? null,
          sourceUrl: asset.sourceUrl,
          sortOrder: asset.sortOrder,
          mimeType: asset.mimeType ?? "image/jpeg",
          width: asset.width,
          height: asset.height
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
          main: buildExtractedImages("main"),
          sku: buildExtractedImages("sku"),
          detail: buildExtractedImages("detail"),
          other: buildExtractedImages("other")
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
  if (queuePumpInFlight) {
    return {
      success: true
    }
  }

  queuePumpInFlight = true

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

    const maxConcurrentTasks = await getMaxConcurrentTasks()
    let claimedTaskId: string | undefined

    while (activeTaskIds.size < maxConcurrentTasks) {
      const response = await fetch(`${API_BASE_URL}/v1/extract/tasks/queue/next`, {
        headers: {
          Authorization: `Bearer ${deviceToken}`
        }
      })

      if (response.status === 204) {
        break
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

      if (activeTaskIds.has(task.taskId)) {
        break
      }

      claimedTaskId = task.taskId
      activeTaskIds.add(task.taskId)

      void executeClaimedTask(task, deviceId, deviceToken)
    }

    return {
      success: true,
      claimedTaskId
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
    queuePumpInFlight = false
  }
}

async function executeClaimedTask(task: QueuedTask, deviceId: string, deviceToken: string) {
  try {
    await executeTask(task, deviceId, deviceToken)
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
            : errorMessage === "no product image urls found"
              ? "PRODUCT_NOT_FOUND"
              : "INTERNAL_ERROR"

    try {
      await markTaskFailed(task, deviceToken, error, errorCode)
    } catch (failError) {
      console.error("mark task failed request failed", failError)
    }
  } finally {
    activeTaskIds.delete(task.taskId)
    void pollNextTask()
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

  if (message?.type === "GET_CONCURRENCY_CONFIG") {
    void (async () => {
      sendResponse({
        maxConcurrentTasks: await getMaxConcurrentTasks(),
        min: MIN_MAX_CONCURRENT_TASKS,
        max: MAX_MAX_CONCURRENT_TASKS,
        defaultValue: DEFAULT_MAX_CONCURRENT_TASKS
      })
    })()
    return true
  }

  if (message?.type === "SET_CONCURRENCY_CONFIG") {
    void (async () => {
      const maxConcurrentTasks = await setMaxConcurrentTasks(message.payload?.maxConcurrentTasks)
      sendResponse({
        maxConcurrentTasks,
        min: MIN_MAX_CONCURRENT_TASKS,
        max: MAX_MAX_CONCURRENT_TASKS,
        defaultValue: DEFAULT_MAX_CONCURRENT_TASKS
      })
      void pollNextTask()
    })()
    return true
  }

  return false
})
