const INSTALLATION_ID_KEY = "installationId"
const DEVICE_ID_KEY = "deviceId"
const DEVICE_TOKEN_KEY = "deviceToken"
const MAX_CONCURRENT_TASKS_KEY = "maxConcurrentTasks"

export const DEFAULT_MAX_CONCURRENT_TASKS = 3
export const MIN_MAX_CONCURRENT_TASKS = 1
export const MAX_MAX_CONCURRENT_TASKS = 5

function createInstallationId() {
  return `ins_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`
}

export async function getInstallationId() {
  const data = await chrome.storage.local.get(INSTALLATION_ID_KEY)

  if (data[INSTALLATION_ID_KEY]) {
    return data[INSTALLATION_ID_KEY] as string
  }

  const installationId = createInstallationId()
  await chrome.storage.local.set({
    [INSTALLATION_ID_KEY]: installationId
  })

  return installationId
}

export async function setDeviceId(deviceId: string) {
  await chrome.storage.local.set({
    [DEVICE_ID_KEY]: deviceId
  })
}

export async function getDeviceId() {
  const data = await chrome.storage.local.get(DEVICE_ID_KEY)
  return (data[DEVICE_ID_KEY] as string | undefined) ?? null
}

export async function setDeviceToken(deviceToken: string) {
  await chrome.storage.local.set({
    [DEVICE_TOKEN_KEY]: deviceToken
  })
}

export async function getDeviceToken() {
  const data = await chrome.storage.local.get(DEVICE_TOKEN_KEY)
  return (data[DEVICE_TOKEN_KEY] as string | undefined) ?? null
}

export function normalizeMaxConcurrentTasks(value: unknown) {
  const numericValue = typeof value === "number" ? value : Number(value)

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_MAX_CONCURRENT_TASKS
  }

  return Math.min(
    MAX_MAX_CONCURRENT_TASKS,
    Math.max(MIN_MAX_CONCURRENT_TASKS, Math.round(numericValue))
  )
}

export async function getMaxConcurrentTasks() {
  const data = await chrome.storage.local.get(MAX_CONCURRENT_TASKS_KEY)
  return normalizeMaxConcurrentTasks(data[MAX_CONCURRENT_TASKS_KEY])
}

export async function setMaxConcurrentTasks(maxConcurrentTasks: number) {
  const normalizedValue = normalizeMaxConcurrentTasks(maxConcurrentTasks)

  await chrome.storage.local.set({
    [MAX_CONCURRENT_TASKS_KEY]: normalizedValue
  })

  return normalizedValue
}
