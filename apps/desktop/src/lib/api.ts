"use client"

import type {
  ConvertAssetRequest,
  ConvertTaskRequest,
  CreateTaskRequest,
  License,
  Task,
  TaskArchive
} from "@tb-pdd-image/shared"

import { API_BASE_URL } from "./config"

const LICENSE_STORAGE_KEY = "tb-license-token"

function normalizeTask(task: Task): Task {
  return {
    ...task,
    counts: {
      main: task.counts?.main ?? 0,
      sku: task.counts?.sku ?? 0,
      detail: task.counts?.detail ?? 0,
      other: task.counts?.other ?? 0
    },
    assets: {
      main: task.assets?.main ?? [],
      sku: task.assets?.sku ?? [],
      detail: task.assets?.detail ?? [],
      other: task.assets?.other ?? []
    }
  }
}

async function readErrorMessage(response: Response, fallback: string) {
  try {
    const contentType = response.headers.get("content-type") || ""

    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as {
        message?: string | string[]
        error?: string
      }

      if (Array.isArray(payload.message) && payload.message.length) {
        return payload.message.join("；")
      }

      if (typeof payload.message === "string" && payload.message.trim()) {
        return payload.message
      }

      if (typeof payload.error === "string" && payload.error.trim()) {
        return payload.error
      }
    }

    const text = (await response.text()).trim()
    return text || fallback
  } catch {
    return fallback
  }
}

function getAuthHeaders() {
  const licenseToken = getStoredLicenseToken()

  const headers = new Headers()

  if (licenseToken) {
    headers.set("Authorization", `Bearer ${licenseToken}`)
  }

  return headers
}

export async function redeemLicense(activationCode: string): Promise<License> {
  const response = await fetch(`${API_BASE_URL}/v1/licenses/redeem`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      activationCode
    })
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "激活失败"))
  }

  const payload = (await response.json()) as License
  localStorage.setItem(LICENSE_STORAGE_KEY, payload.licenseToken)
  return payload
}

export function getStoredLicenseToken() {
  return localStorage.getItem(LICENSE_STORAGE_KEY)
}

export async function createTask(input: CreateTaskRequest) {
  const response = await fetch(`${API_BASE_URL}/v1/extract/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(getAuthHeaders().entries())
    },
    body: JSON.stringify(input)
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "创建任务失败"))
  }

  return (await response.json()) as {
    taskId: string
  }
}

export async function getTask(taskId: string) {
  const response = await fetch(`${API_BASE_URL}/v1/extract/tasks/${taskId}`, {
    cache: "no-store",
    headers: getAuthHeaders()
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "获取任务失败"))
  }

  return normalizeTask((await response.json()) as Task)
}

export async function requestArchive(taskId: string, retentionDays: 3 | 7 | 30) {
  const response = await fetch(`${API_BASE_URL}/v1/extract/tasks/${taskId}/archive`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(getAuthHeaders().entries())
    },
    body: JSON.stringify({
      retentionDays
    })
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "触发 ZIP 失败"))
  }

  return (await response.json()) as TaskArchive
}

export async function convertTask(taskId: string, input: ConvertTaskRequest) {
  const response = await fetch(`${API_BASE_URL}/v1/extract/tasks/${taskId}/convert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(getAuthHeaders().entries())
    },
    body: JSON.stringify(input)
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "任务格式转换失败"))
  }

  return response.json()
}

export async function convertAsset(assetId: string, input: ConvertAssetRequest) {
  const response = await fetch(`${API_BASE_URL}/v1/assets/${assetId}/convert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(getAuthHeaders().entries())
    },
    body: JSON.stringify(input)
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "单图格式转换失败"))
  }

  return response.json()
}

export async function listTasks() {
  const response = await fetch(`${API_BASE_URL}/v1/extract/tasks`, {
    cache: "no-store",
    headers: getAuthHeaders()
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "获取历史任务失败"))
  }

  const payload = (await response.json()) as {
    items: Task[]
  }

  return {
    items: payload.items.map(normalizeTask)
  }
}
