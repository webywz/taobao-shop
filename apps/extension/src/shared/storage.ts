const INSTALLATION_ID_KEY = "installationId"
const DEVICE_ID_KEY = "deviceId"
const DEVICE_TOKEN_KEY = "deviceToken"
const LICENSE_TOKEN_KEY = "licenseToken"
const PDD_WORK_TAB_ID_KEY = "pddWorkTabId"

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

export async function setLicenseToken(licenseToken: string) {
  await chrome.storage.local.set({
    [LICENSE_TOKEN_KEY]: licenseToken
  })
}

export async function getLicenseToken() {
  const data = await chrome.storage.local.get(LICENSE_TOKEN_KEY)
  return (data[LICENSE_TOKEN_KEY] as string | undefined) ?? null
}

export async function setPddWorkTabId(tabId: number) {
  await chrome.storage.local.set({
    [PDD_WORK_TAB_ID_KEY]: tabId
  })
}

export async function getPddWorkTabId() {
  const data = await chrome.storage.local.get(PDD_WORK_TAB_ID_KEY)
  const tabId = data[PDD_WORK_TAB_ID_KEY]
  return typeof tabId === "number" ? tabId : null
}

export async function clearPddWorkTabId() {
  await chrome.storage.local.remove(PDD_WORK_TAB_ID_KEY)
}
