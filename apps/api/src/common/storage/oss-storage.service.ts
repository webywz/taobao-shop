import { Injectable } from "@nestjs/common"
import OSS from "ali-oss"
import type { GroupType } from "@tb-pdd-image/shared"

const DEFAULT_REGION = "oss-cn-beijing"
const DEFAULT_BUCKET_NAME = "local-bucket"
const DEFAULT_PATH_PREFIX = "uploads/"
const DEFAULT_SIGN_URL_EXPIRES = 3600

type StorageKind = "original" | "archives" | "converted"

type OssConfig = {
  region: string
  accessKeyId?: string
  accessKeySecret?: string
  bucketName: string
  endpoint?: string
  pathPrefix: string
  useSsl: boolean
  useSignedUrl: boolean
  signUrlExpires: number
  useCname: boolean
}

function normalizeEndpoint(value: string | undefined, useSsl: boolean) {
  const trimmed = value?.trim()

  if (!trimmed) {
    return undefined
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed
  }

  return `${useSsl ? "https" : "http"}://${trimmed}`
}

function shouldUseCname(endpoint: string | undefined, bucketName: string) {
  if (!endpoint) {
    return false
  }

  try {
    const hostname = new URL(endpoint).hostname
    return hostname.includes(bucketName)
  } catch {
    return false
  }
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
}

function normalizePathPrefix(value: string | undefined) {
  const trimmed = value?.trim() || DEFAULT_PATH_PREFIX
  const withoutLeadingSlash = trimmed.replace(/^\/+/, "")
  if (!withoutLeadingSlash) {
    return ""
  }

  return withoutLeadingSlash.endsWith("/") ? withoutLeadingSlash : `${withoutLeadingSlash}/`
}

function normalizeExtension(ext: string) {
  return ext.replace(/^\.+/, "").toLowerCase()
}

function encodeObjectKey(objectKey: string) {
  return objectKey
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

@Injectable()
export class OssStorageService {
  private readonly config = this.readConfig()
  private readonly client = this.createClient()

  createOriginalAssetUpload(input: {
    taskId: string
    groupType: GroupType
    assetId: string
    ext: string
    mimeType: string
  }) {
    const storageKey = this.buildObjectKey(
      "original",
      input.taskId,
      input.groupType,
      `${input.assetId}.${normalizeExtension(input.ext)}`
    )

    return {
      storageKey,
      method: "PUT" as const,
      uploadUrl: this.createSignedOrPublicUrl(storageKey, "PUT", input.mimeType),
      accessUrl: this.createReadUrl(storageKey)
    }
  }

  createArchiveObject(taskId: string, archiveId: string) {
    const storageKey = this.buildObjectKey("archives", taskId, `${archiveId}.zip`)

    return {
      storageKey,
      downloadUrl: this.createReadUrl(storageKey)
    }
  }

  createConvertedObject(input: {
    taskId: string
    assetType: GroupType
    assetId: string
    targetFormat: "jpg" | "png" | "webp"
    jobId: string
  }) {
    const storageKey = this.buildObjectKey(
      "converted",
      input.taskId,
      input.assetType,
      `${input.assetId}-${input.jobId}.${input.targetFormat}`
    )

    return {
      storageKey,
      downloadUrl: this.createReadUrl(storageKey)
    }
  }

  getReadUrl(storageKey: string) {
    return this.createReadUrl(storageKey)
  }

  private readConfig(): OssConfig {
    const useSsl = parseBoolean(process.env.OSS_USE_SSL, true)
    const bucketName =
      process.env.OSS_BUCKET_NAME?.trim() || process.env.OSS_BUCKET?.trim() || DEFAULT_BUCKET_NAME
    const explicitEndpoint = normalizeEndpoint(process.env.OSS_ENDPOINT, useSsl)

    return {
      region: process.env.OSS_REGION?.trim() || DEFAULT_REGION,
      accessKeyId: process.env.OSS_ACCESS_KEY_ID?.trim() || undefined,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET?.trim() || undefined,
      bucketName,
      endpoint: explicitEndpoint || undefined,
      pathPrefix: normalizePathPrefix(process.env.OSS_PATH_PREFIX),
      useSsl,
      useSignedUrl: parseBoolean(process.env.OSS_USE_SIGN_URL, true),
      signUrlExpires: Number.parseInt(
        process.env.OSS_SIGN_URL_EXPIRES?.trim() || String(DEFAULT_SIGN_URL_EXPIRES),
        10
      ),
      useCname: shouldUseCname(explicitEndpoint, bucketName)
    }
  }

  private createClient() {
    if (!this.config.accessKeyId || !this.config.accessKeySecret || !this.config.bucketName) {
      return null
    }

    return new OSS({
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      accessKeySecret: this.config.accessKeySecret,
      bucket: this.config.bucketName,
      endpoint: this.config.endpoint,
      secure: this.config.useSsl,
      cname: this.config.useCname
    })
  }

  private buildObjectKey(kind: StorageKind, ...segments: string[]) {
    return `${this.config.pathPrefix}${kind}/${segments.join("/")}`
  }

  private createReadUrl(storageKey: string) {
    return this.createSignedOrPublicUrl(storageKey, "GET")
  }

  private createSignedOrPublicUrl(
    storageKey: string,
    method: "GET" | "PUT",
    contentType?: string
  ) {
    if (this.client && this.config.useSignedUrl) {
      return this.client.signatureUrl(storageKey, {
        method,
        expires: this.config.signUrlExpires,
        ...(contentType
          ? {
              "Content-Type": contentType
            }
          : {})
      })
    }

    return this.createPublicUrl(storageKey)
  }

  private createPublicUrl(storageKey: string) {
    const baseUrl = this.config.endpoint
      ? this.config.useCname
        ? this.config.endpoint
        : new URL(`${this.config.bucketName}/`, this.config.endpoint).toString()
      : `https://${this.config.bucketName}.${this.config.region}.aliyuncs.com`

    return new URL(
      encodeObjectKey(storageKey),
      baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
    ).toString()
  }
}
