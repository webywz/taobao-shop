"use client"

import type {
  ConvertAssetRequest,
  ConvertTaskRequest,
  CreateTasksBatchRequest,
  CreateTasksBatchResponse,
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
        detail?: string | string[]
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

      if (Array.isArray(payload.detail) && payload.detail.length) {
        return payload.detail.join("；")
      }

      if (typeof payload.detail === "string" && payload.detail.trim()) {
        return payload.detail
      }
    }

    const text = (await response.text()).trim()
    return text || fallback
  } catch {
    return fallback
  }
}

async function apiFetch(path: string, init: RequestInit, fallback: string) {
  try {
    return await fetch(`${API_BASE_URL}${path}`, init)
  } catch {
    throw new Error(`${fallback}：无法连接后端服务 ${API_BASE_URL}，请确认 API 已启动`)
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

function isLicenseExpiredMessage(message: string) {
  return message.includes("license expired") || message.includes("license not found")
}

async function throwApiError(response: Response, fallback: string): Promise<never> {
  const message = await readErrorMessage(response, fallback)

  if (response.status === 401 && isLicenseExpiredMessage(message)) {
    clearStoredLicenseToken()
    throw new Error("卡密已过期或失效，请重新激活")
  }

  throw new Error(message)
}

export async function redeemLicense(activationCode: string): Promise<License> {
  const response = await apiFetch("/v1/licenses/redeem", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      activationCode
    })
  }, "激活失败")

  if (!response.ok) {
    await throwApiError(response, "激活失败")
  }

  const payload = (await response.json()) as License
  localStorage.setItem(LICENSE_STORAGE_KEY, payload.licenseToken)
  return payload
}

export function getStoredLicenseToken() {
  return localStorage.getItem(LICENSE_STORAGE_KEY)
}

export function clearStoredLicenseToken() {
  localStorage.removeItem(LICENSE_STORAGE_KEY)
}

export async function getCurrentLicense() {
  const response = await apiFetch("/v1/licenses/current", {
    cache: "no-store",
    headers: getAuthHeaders()
  }, "获取授权状态失败")

  if (!response.ok) {
    await throwApiError(response, "获取授权状态失败")
  }

  return (await response.json()) as License
}

export async function createTask(input: CreateTaskRequest) {
  const response = await apiFetch("/v1/extract/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(getAuthHeaders().entries())
    },
    body: JSON.stringify(input)
  }, "创建任务失败")

  if (!response.ok) {
    await throwApiError(response, "创建任务失败")
  }

  return (await response.json()) as {
    taskId: string
  }
}

export async function createTasksBatch(input: CreateTasksBatchRequest) {
  const response = await apiFetch("/v1/extract/tasks/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(getAuthHeaders().entries())
    },
    body: JSON.stringify(input)
  }, "批量创建任务失败")

  if (!response.ok) {
    await throwApiError(response, "批量创建任务失败")
  }

  return (await response.json()) as CreateTasksBatchResponse
}

export async function getTask(taskId: string) {
  const response = await fetch(`${API_BASE_URL}/v1/extract/tasks/${taskId}`, {
    cache: "no-store",
    headers: getAuthHeaders()
  })

  if (!response.ok) {
    await throwApiError(response, "获取任务失败")
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
    await throwApiError(response, "触发 ZIP 失败")
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
    await throwApiError(response, "任务格式转换失败")
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
    await throwApiError(response, "单图格式转换失败")
  }

  return response.json()
}

export async function listTasks() {
  const response = await fetch(`${API_BASE_URL}/v1/extract/tasks`, {
    cache: "no-store",
    headers: getAuthHeaders()
  })

  if (!response.ok) {
    await throwApiError(response, "获取历史任务失败")
  }

  const payload = (await response.json()) as {
    items: Task[]
  }

  return {
    items: payload.items.map(normalizeTask)
  }
}
