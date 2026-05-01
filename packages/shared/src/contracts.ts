export type Platform = "taobao"
export type TaskStatus =
  | "pending"
  | "claimed"
  | "running"
  | "uploading"
  | "completed"
  | "failed"
  | "expired"
export type ArchiveStatus = "not_started" | "processing" | "ready" | "failed"
export type ConvertStatus = "pending" | "processing" | "completed" | "failed"
export type DeviceStatus = "active" | "revoked" | "offline"
export type GroupType = "main" | "sku" | "detail" | "other"
export type RetentionDays = 3 | 7 | 30

export interface ApiError {
  code:
    | "INVALID_ACTIVATION_CODE"
    | "ACTIVATION_CODE_USED"
    | "LICENSE_INACTIVE"
    | "INVALID_URL"
    | "UNSUPPORTED_PLATFORM"
    | "DEVICE_REVOKED"
    | "TASK_TOKEN_INVALID"
    | "TASK_ALREADY_CLAIMED"
    | "TASK_STATUS_INVALID"
    | "AUTH_REQUIRED"
    | "PAGE_TIMEOUT"
    | "PRODUCT_NOT_FOUND"
    | "UNSUPPORTED_LAYOUT"
    | "UPLOAD_FAILED"
    | "ARCHIVE_FAILED"
    | "CONVERT_FAILED"
    | "RATE_LIMITED"
    | "INTERNAL_ERROR"
  message: string
  requestId: string
  retryable?: boolean
  details?: Record<string, unknown>
}

export interface License {
  licenseId: string
  licenseToken: string
  durationDays: number
  expiresAt: string
}

export interface Device {
  deviceId: string
  installationId: string
  status: DeviceStatus
  licenseId?: string
  extensionVersion: string
  lastHeartbeatAt?: string
}

export interface Asset {
  assetId: string
  groupType: GroupType
  skuName: string | null
  sourceUrl: string
  previewUrl?: string
  downloadUrl?: string
  mimeType: string
  width?: number
  height?: number
  fileSize?: number
  sortOrder: number
}

export interface TaskCounts {
  main: number
  sku: number
  detail: number
  other: number
}

export interface TaskArchive {
  archiveId?: string
  status: ArchiveStatus
  retentionDays?: RetentionDays
  downloadUrl?: string
  fileSize?: number
  expiresAt?: string
}

export interface Task {
  taskId: string
  platform: Platform
  status: TaskStatus
  sourceUrl: string
  canonicalUrl: string
  title?: string | null
  productId?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  extractorVersion?: string | null
  counts: TaskCounts
  assets: Record<GroupType, Asset[]>
  archive: TaskArchive
  createdAt: string
  completedAt?: string | null
}

export interface RedeemLicenseRequest {
  activationCode: string
}

export interface RegisterDeviceRequest {
  installationId: string
  browserName: "chrome"
  browserVersion: string
  os: string
  extensionVersion: string
}

export interface CreateTaskRequest {
  sourceUrl: string
}

export interface CreateTasksBatchRequest {
  sourceUrls: string[]
}

export interface CreateTasksBatchItem {
  sourceUrl: string
  success: boolean
  taskId?: string
  platform?: Platform
  status?: TaskStatus
  createdAt?: string
  errorMessage?: string
}

export interface CreateTasksBatchResponse {
  items: CreateTasksBatchItem[]
  total: number
  successCount: number
  failedCount: number
}

export interface ClaimTaskRequest {
  taskToken: string
}

export interface HeartbeatRequest {
  currentTaskId: string | null
  taskStatus: "idle" | "claimed" | "running" | "uploading"
  sentAt: string
}

export interface TaskProgressRequest {
  taskToken: string
  status: "running" | "uploading"
  stage?: string
  sentAt: string
}

export interface ConvertAssetRequest {
  targetFormat: "jpg" | "png" | "webp"
  retentionDays: RetentionDays
}

export interface ConvertTaskRequest extends ConvertAssetRequest {
  assetType: GroupType
}

export interface ManifestAssetInput {
  groupType: GroupType
  skuName?: string | null
  sourceUrl: string
  mimeType?: string
  width?: number
  height?: number
  fileSize?: number
  sortOrder: number
}

export interface SubmitTaskResultRequest {
  taskToken: string
  title?: string | null
  productId?: string | null
  canonicalUrl: string
  extractorVersion: string
  images: Record<GroupType, ManifestAssetInput[]>
  meta: {
    capturedAt: string
  }
}

export interface SubmitTaskFailRequest {
  taskToken: string
  errorCode: ApiError["code"]
  errorMessage: string
  retryable?: boolean
  diagnostics?: Record<string, unknown>
}

export interface PresignUploadFileRequest {
  clientAssetId: string
  groupType: GroupType
  ext: string
  mimeType: string
}

export interface PresignUploadRequest {
  taskId: string
  files: PresignUploadFileRequest[]
}

export interface CompleteUploadRequest {
  taskId: string
  uploads: Array<{
    assetId: string
    clientAssetId: string
    storageKey: string
  }>
}
