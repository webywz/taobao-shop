import {
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException
} from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import type {
  Asset,
  BindLicenseRequest,
  ClaimTaskRequest,
  CompleteUploadRequest,
  ConvertAssetRequest,
  ConvertTaskRequest,
  CreateTaskRequest,
  Device,
  HeartbeatRequest,
  License,
  Platform,
  PresignUploadRequest,
  RegisterDeviceRequest,
  RetentionDays,
  SubmitTaskFailRequest,
  SubmitTaskResultRequest,
  Task,
  TaskArchive,
  TaskProgressRequest
} from "@tb-pdd-image/shared"

import { OssStorageService } from "../storage/oss-storage.service.js"

type TaskRow = {
  id: string
  platform: Platform
  status: Task["status"]
  source_url: string
  canonical_url: string
  title: string | null
  product_id: string | null
  error_code: string | null
  error_message: string | null
  extractor_version: string | null
  created_at: Date
  completed_at: Date | null
}

type AssetRow = {
  id: string
  group_type: Asset["groupType"]
  sku_name: string | null
  source_url: string
  preview_url: string | null
  download_url: string | null
  mime_type: string
  width: number | null
  height: number | null
  file_size: number | null
  sort_order: number
}

type ArchiveRow = {
  archive_id: string
  status: TaskArchive["status"]
  retention_days: number | null
  download_url: string | null
  file_size: number | null
  expires_at: Date | null
}

function getDatabaseUrl() {
  return process.env.DATABASE_URL?.trim() || "postgres://postgres:postgres@127.0.0.1:5432/postgres"
}

const SCHEMA_SQL = `
create table if not exists activation_codes (
  code text primary key,
  license_id text unique,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists licenses (
  id text primary key,
  token text not null unique,
  duration_days integer not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists devices (
  id text primary key,
  installation_id text not null unique,
  device_token text not null unique,
  status text not null,
  license_id text references licenses(id),
  browser_name text not null,
  browser_version text not null,
  os text not null,
  extension_version text not null,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id text primary key,
  license_id text not null references licenses(id),
  device_id text references devices(id),
  task_token text not null unique,
  platform text not null,
  status text not null,
  source_url text not null,
  canonical_url text not null,
  title text,
  product_id text,
  error_code text,
  error_message text,
  extractor_version text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_tasks_license_created_at on tasks(license_id, created_at desc);
create index if not exists idx_tasks_status_created_at on tasks(status, created_at asc);

create table if not exists task_assets (
  id text primary key,
  task_id text not null references tasks(id) on delete cascade,
  group_type text not null,
  sku_name text,
  source_url text not null,
  preview_url text,
  download_url text,
  mime_type text not null,
  width integer,
  height integer,
  file_size integer,
  sort_order integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_assets_task_group_sort on task_assets(task_id, group_type, sort_order);

create table if not exists task_archives (
  task_id text primary key references tasks(id) on delete cascade,
  archive_id text not null unique,
  status text not null,
  retention_days integer,
  download_url text,
  file_size integer,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists asset_convert_jobs (
  id text primary key,
  task_id text not null references tasks(id) on delete cascade,
  asset_id text references task_assets(id) on delete cascade,
  asset_type text,
  target_format text not null,
  retention_days integer not null,
  status text not null,
  created_at timestamptz not null default now()
);
`

function createId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`
}

function plusDays(days: number) {
  const now = new Date()
  now.setDate(now.getDate() + days)
  return now.toISOString()
}

function detectPlatform(sourceUrl: string): Platform {
  let hostname = ""

  try {
    hostname = new URL(sourceUrl).hostname.toLowerCase()
  } catch {
    throw new NotFoundException("invalid source url")
  }

  const isTaobaoHost =
    hostname === "m.tb.cn" ||
    hostname === "e.tb.cn" ||
    hostname.endsWith(".tmall.com") ||
    hostname === "tmall.com" ||
    hostname.endsWith(".taobao.com") ||
    hostname === "taobao.com"

  if (isTaobaoHost) {
    return "taobao"
  }

  const isPddHost =
    hostname.endsWith(".yangkeduo.com") ||
    hostname === "yangkeduo.com" ||
    hostname.endsWith(".pinduoduo.com") ||
    hostname === "pinduoduo.com"

  if (isPddHost) {
    return "pdd"
  }

  throw new NotFoundException(
    "unsupported platform: only taobao.com, tmall.com, m.tb.cn, pinduoduo.com, yangkeduo.com are supported"
  )
}

function getBearerToken(authorization?: string) {
  if (!authorization?.startsWith("Bearer ")) {
    throw new UnauthorizedException("missing bearer token")
  }

  return authorization.slice("Bearer ".length).trim()
}

@Injectable()
export class DatabaseStore implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool

  constructor(@Inject(OssStorageService) private readonly storage: OssStorageService) {
    this.pool = new Pool({
      connectionString: getDatabaseUrl()
    })
  }

  async onModuleInit() {
    await this.pool.query(SCHEMA_SQL)
  }

  async onModuleDestroy() {
    await this.pool.end()
  }

  async redeemLicense(activationCode: string) {
    const existingCode = await this.pool.query<{ license_id: string | null }>(
      "select license_id from activation_codes where code = $1",
      [activationCode]
    )

    if (existingCode.rowCount && existingCode.rows[0]?.license_id) {
      throw new UnauthorizedException("activation code already redeemed")
    }

    const durationDays = 30
    const licenseId = createId("lic")
    const licenseToken = createId("ltok")
    const expiresAt = plusDays(durationDays)

    const client = await this.pool.connect()

    try {
      await client.query("begin")
      await client.query(
        `
          insert into licenses (id, token, duration_days, expires_at)
          values ($1, $2, $3, $4::timestamptz)
        `,
        [licenseId, licenseToken, durationDays, expiresAt]
      )

      await client.query(
        `
          insert into activation_codes (code, license_id, redeemed_at)
          values ($1, $2, now())
          on conflict (code)
          do update set license_id = excluded.license_id, redeemed_at = excluded.redeemed_at
        `,
        [activationCode, licenseId]
      )

      await client.query("commit")
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }

    return {
      licenseId,
      licenseToken,
      durationDays,
      expiresAt,
      activationCode
    }
  }

  async getCurrentLicense(authorization?: string) {
    return this.getLicenseByToken(getBearerToken(authorization))
  }

  async registerDevice(input: RegisterDeviceRequest) {
    const existing = await this.pool.query<{
      id: string
      device_token: string
      status: Device["status"]
    }>(
      `
        select id, device_token, status
        from devices
        where installation_id = $1
      `,
      [input.installationId]
    )

    if (existing.rowCount) {
      return {
        deviceId: existing.rows[0].id,
        deviceToken: existing.rows[0].device_token,
        status: existing.rows[0].status
      }
    }

    const deviceId = createId("dev")
    const deviceToken = createId("dtok")

    await this.pool.query(
      `
        insert into devices (
          id, installation_id, device_token, status, license_id,
          browser_name, browser_version, os, extension_version
        )
        values ($1, $2, $3, 'active', null, $4, $5, $6, $7)
      `,
      [
        deviceId,
        input.installationId,
        deviceToken,
        input.browserName,
        input.browserVersion,
        input.os,
        input.extensionVersion
      ]
    )

    return {
      deviceId,
      deviceToken,
      status: "active"
    }
  }

  async bindLicense(deviceId: string, input: BindLicenseRequest) {
    const license = await this.getLicenseByToken(input.licenseToken)
    const result = await this.pool.query(
      `
        update devices
        set license_id = $2
        where id = $1
        returning id
      `,
      [deviceId, license.licenseId]
    )

    if (!result.rowCount) {
      throw new NotFoundException("device not found")
    }

    return {
      deviceId,
      licenseId: license.licenseId,
      status: "bound"
    }
  }

  async heartbeat(deviceId: string, input: HeartbeatRequest, authorization?: string) {
    const device = await this.getDeviceByToken(authorization)

    if (device.deviceId !== deviceId) {
      throw new UnauthorizedException("device mismatch")
    }

    await this.pool.query(
      `
        update devices
        set last_heartbeat_at = $2::timestamptz
        where id = $1
      `,
      [deviceId, input.sentAt]
    )

    return {
      deviceId,
      currentTaskId: input.currentTaskId,
      taskStatus: input.taskStatus,
      receivedAt: new Date().toISOString()
    }
  }

  async createTask(input: CreateTaskRequest, authorization?: string) {
    const license = await this.getLicenseByToken(getBearerToken(authorization))
    const platform = detectPlatform(input.sourceUrl)
    const taskId = createId("task")
    const taskToken = createId("ttok")
    const createdAt = new Date().toISOString()

    await this.pool.query(
      `
        insert into tasks (
          id, license_id, device_id, task_token, platform, status, source_url, canonical_url, created_at
        )
        values ($1, $2, null, $3, $4, 'pending', $5, $6, $7::timestamptz)
      `,
      [taskId, license.licenseId, taskToken, platform, input.sourceUrl, input.sourceUrl, createdAt]
    )

    return {
      taskId,
      platform,
      status: "pending",
      sourceUrl: input.sourceUrl,
      canonicalUrl: input.sourceUrl,
      createdAt
    }
  }

  async listTasks(authorization?: string) {
    const license = await this.getLicenseByToken(getBearerToken(authorization))
    const rows = await this.pool.query<TaskRow>(
      `
        select id, platform, status, source_url, canonical_url, title, product_id, error_code,
               error_message, extractor_version, created_at, completed_at
        from tasks
        where license_id = $1
        order by created_at desc
      `,
      [license.licenseId]
    )

    return Promise.all(rows.rows.map((row) => this.hydrateTask(row)))
  }

  async getTask(taskId: string, authorization?: string) {
    const license = await this.getLicenseByToken(getBearerToken(authorization))
    const rows = await this.pool.query<TaskRow>(
      `
        select id, platform, status, source_url, canonical_url, title, product_id, error_code,
               error_message, extractor_version, created_at, completed_at
        from tasks
        where id = $1 and license_id = $2
      `,
      [taskId, license.licenseId]
    )

    if (!rows.rowCount) {
      throw new NotFoundException("task not found")
    }

    return this.hydrateTask(rows.rows[0])
  }

  async nextTask(authorization?: string) {
    const device = await this.getDeviceByToken(authorization)

    if (!device.licenseId) {
      return null
    }

    const rows = await this.pool.query<{
      id: string
      platform: Platform
      source_url: string
      task_token: string
    }>(
      `
        select id, platform, source_url, task_token
        from tasks
        where license_id = $1 and status = 'pending'
        order by created_at asc
        limit 1
      `,
      [device.licenseId]
    )

    if (!rows.rowCount) {
      return null
    }

    return {
      taskId: rows.rows[0].id,
      platform: rows.rows[0].platform,
      sourceUrl: rows.rows[0].source_url,
      taskToken: rows.rows[0].task_token,
      expiresAt: plusDays(1)
    }
  }

  async claimTask(taskId: string, input: ClaimTaskRequest, authorization?: string) {
    const device = await this.getDeviceByToken(authorization)
    const task = await this.getTaskRecordByToken(taskId, input.taskToken)

    if (task.license_id !== device.licenseId) {
      throw new UnauthorizedException("task not available for device")
    }

    await this.pool.query(
      `
        update tasks
        set status = 'claimed', device_id = $2
        where id = $1
      `,
      [taskId, device.deviceId]
    )

    return {
      taskId,
      status: "claimed",
      claimedAt: new Date().toISOString()
    }
  }

  async updateTaskProgress(taskId: string, input: TaskProgressRequest, authorization?: string) {
    const device = await this.getDeviceByToken(authorization)
    await this.assertTaskOwnedByDevice(taskId, input.taskToken, device.deviceId)

    await this.pool.query("update tasks set status = $2 where id = $1", [taskId, input.status])

    return {
      taskId,
      status: input.status,
      stage: input.stage ?? null,
      updatedAt: new Date().toISOString()
    }
  }

  async submitResult(taskId: string, input: SubmitTaskResultRequest, authorization?: string) {
    const device = await this.getDeviceByToken(authorization)
    await this.assertTaskOwnedByDevice(taskId, input.taskToken, device.deviceId)

    const client = await this.pool.connect()

    try {
      await client.query("begin")
      await client.query("delete from task_assets where task_id = $1", [taskId])

      const groups = Object.entries(input.images) as Array<
        [Asset["groupType"], SubmitTaskResultRequest["images"]["main"]]
      >

      for (const [groupType, assets] of groups) {
        for (const item of assets) {
          const assetId = createId("asset")
          await client.query(
            `
              insert into task_assets (
                id, task_id, group_type, sku_name, source_url, preview_url, download_url,
                mime_type, width, height, file_size, sort_order
              )
              values ($1, $2, $3, $4, $5, $5, $5, $6, $7, $8, $9, $10)
            `,
            [
              assetId,
              taskId,
              groupType,
              item.skuName ?? null,
              item.sourceUrl,
              item.mimeType ?? "image/jpeg",
              item.width ?? null,
              item.height ?? null,
              item.fileSize ?? null,
              item.sortOrder
            ]
          )
        }
      }

      await client.query(
        `
          update tasks
          set status = 'completed',
              title = $2,
              product_id = $3,
              canonical_url = $4,
              extractor_version = $5,
              completed_at = now(),
              error_code = null,
              error_message = null
          where id = $1
        `,
        [
          taskId,
          input.title ?? null,
          input.productId ?? null,
          input.canonicalUrl,
          input.extractorVersion
        ]
      )

      await client.query("commit")
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }

    return this.getTaskByIdWithoutAuth(taskId)
  }

  async submitFail(taskId: string, input: SubmitTaskFailRequest, authorization?: string) {
    const device = await this.getDeviceByToken(authorization)
    await this.assertTaskOwnedByDevice(taskId, input.taskToken, device.deviceId)

    await this.pool.query(
      `
        update tasks
        set status = 'failed',
            error_code = $2,
            error_message = $3,
            completed_at = now()
        where id = $1
      `,
      [taskId, input.errorCode, input.errorMessage]
    )

    return this.getTaskByIdWithoutAuth(taskId)
  }

  async requestArchive(taskId: string, retentionDays: RetentionDays = 7, authorization?: string) {
    await this.getTask(taskId, authorization)
    const archiveId = createId("arc")
    const archiveObject = this.storage.createArchiveObject(taskId, archiveId)

    await this.pool.query(
      `
        insert into task_archives (task_id, archive_id, status, retention_days, download_url, file_size, expires_at, updated_at)
        values ($1, $2, 'ready', $3, $4, $5, $6::timestamptz, now())
        on conflict (task_id)
        do update set
          archive_id = excluded.archive_id,
          status = excluded.status,
          retention_days = excluded.retention_days,
          download_url = excluded.download_url,
          file_size = excluded.file_size,
          expires_at = excluded.expires_at,
          updated_at = now()
      `,
      [
        taskId,
        archiveId,
        retentionDays,
        archiveObject.downloadUrl,
        1024,
        plusDays(retentionDays)
      ]
    )

    return this.getArchive(taskId, authorization)
  }

  async getArchive(taskId: string, authorization?: string) {
    await this.getTask(taskId, authorization)

    const rows = await this.pool.query<ArchiveRow>(
      `
        select archive_id, status, retention_days, download_url, file_size, expires_at
        from task_archives
        where task_id = $1
      `,
      [taskId]
    )

    if (!rows.rowCount) {
      return {
        taskId,
        status: "not_started"
      }
    }

    return {
      taskId,
      archiveId: rows.rows[0].archive_id,
      status: rows.rows[0].status,
      retentionDays: (rows.rows[0].retention_days ?? undefined) as RetentionDays | undefined,
      downloadUrl: rows.rows[0].download_url ?? undefined,
      fileSize: rows.rows[0].file_size ?? undefined,
      expiresAt: rows.rows[0].expires_at?.toISOString()
    }
  }

  async convertAsset(assetId: string, input: ConvertAssetRequest, authorization?: string) {
    const license = await this.getLicenseByToken(getBearerToken(authorization))
    const rows = await this.pool.query<{ task_id: string; group_type: Asset["groupType"] }>(
      `
        select ta.task_id, ta.group_type
        from task_assets ta
        join tasks t on t.id = ta.task_id
        where ta.id = $1 and t.license_id = $2
      `,
      [assetId, license.licenseId]
    )

    if (!rows.rowCount) {
      throw new NotFoundException("asset not found")
    }

    const jobId = createId("conv")
    const convertedObject = this.storage.createConvertedObject({
      taskId: rows.rows[0].task_id,
      assetType: rows.rows[0].group_type,
      assetId,
      targetFormat: input.targetFormat,
      jobId
    })
    await this.pool.query(
      `
        insert into asset_convert_jobs (id, task_id, asset_id, asset_type, target_format, retention_days, status)
        values ($1, $2, $3, null, $4, $5, 'processing')
      `,
      [jobId, rows.rows[0].task_id, assetId, input.targetFormat, input.retentionDays]
    )

    return {
      jobId,
      assetId,
      targetFormat: input.targetFormat,
      retentionDays: input.retentionDays,
      status: "processing",
      downloadUrl: convertedObject.downloadUrl
    }
  }

  async convertTask(taskId: string, input: ConvertTaskRequest, authorization?: string) {
    const task = await this.getTask(taskId, authorization)

    const jobs = task.assets[input.assetType].map((asset) => {
      const jobId = createId("conv")
      return {
        jobId,
        assetId: asset.assetId,
        downloadUrl: this.storage.createConvertedObject({
          taskId,
          assetType: input.assetType,
          assetId: asset.assetId,
          targetFormat: input.targetFormat,
          jobId
        }).downloadUrl
      }
    })

    await Promise.all(
      jobs.map((job) =>
        this.pool.query(
          `
            insert into asset_convert_jobs (id, task_id, asset_id, asset_type, target_format, retention_days, status)
            values ($1, $2, $3, $4, $5, $6, 'processing')
          `,
          [job.jobId, taskId, job.assetId, input.assetType, input.targetFormat, input.retentionDays]
        )
      )
    )

    return {
      taskId,
      targetFormat: input.targetFormat,
      assetType: input.assetType,
      retentionDays: input.retentionDays,
      jobCount: task.assets[input.assetType].length,
      status: "processing",
      jobs
    }
  }

  async presignUploads(input: PresignUploadRequest, authorization?: string) {
    await this.getDeviceByToken(authorization)
    await this.getTaskByIdWithoutAuth(input.taskId)

    return {
      uploads: input.files.map((file) => {
        const assetId = createId("asset")
        const upload = this.storage.createOriginalAssetUpload({
          taskId: input.taskId,
          groupType: file.groupType,
          assetId,
          ext: file.ext,
          mimeType: file.mimeType
        })
        return {
          clientAssetId: file.clientAssetId,
          assetId,
          storageKey: upload.storageKey,
          method: upload.method,
          uploadUrl: upload.uploadUrl,
          accessUrl: upload.accessUrl
        }
      })
    }
  }

  async completeUploads(input: CompleteUploadRequest, authorization?: string) {
    await this.getDeviceByToken(authorization)
    await this.getTaskByIdWithoutAuth(input.taskId)

    return {
      taskId: input.taskId,
      completedCount: input.uploads.length,
      completedAt: new Date().toISOString(),
      uploads: input.uploads.map((upload) => ({
        ...upload,
        accessUrl: this.storage.getReadUrl(upload.storageKey)
      }))
    }
  }

  private async hydrateTask(row: TaskRow): Promise<Task> {
    const assetsRows = await this.pool.query<AssetRow>(
      `
        select id, group_type, sku_name, source_url, preview_url, download_url, mime_type,
               width, height, file_size, sort_order
        from task_assets
        where task_id = $1
        order by group_type asc, sort_order asc
      `,
      [row.id]
    )

    const archiveRows = await this.pool.query<ArchiveRow>(
      `
        select archive_id, status, retention_days, download_url, file_size, expires_at
        from task_archives
        where task_id = $1
      `,
      [row.id]
    )

    const assets = {
      main: [] as Asset[],
      sku: [] as Asset[],
      detail: [] as Asset[],
      other: [] as Asset[]
    }

    for (const asset of assetsRows.rows) {
      assets[asset.group_type].push({
        assetId: asset.id,
        groupType: asset.group_type,
        skuName: asset.sku_name,
        sourceUrl: asset.source_url,
        previewUrl: asset.preview_url ?? undefined,
        downloadUrl: asset.download_url ?? undefined,
        mimeType: asset.mime_type,
        width: asset.width ?? undefined,
        height: asset.height ?? undefined,
        fileSize: asset.file_size ?? undefined,
        sortOrder: asset.sort_order
      })
    }

    return {
      taskId: row.id,
      platform: row.platform,
      status: row.status,
      sourceUrl: row.source_url,
      canonicalUrl: row.canonical_url,
      title: row.title,
      productId: row.product_id,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      extractorVersion: row.extractor_version,
      counts: {
        main: assets.main.length,
        sku: assets.sku.length,
        detail: assets.detail.length,
        other: assets.other.length
      },
      assets,
      archive: archiveRows.rowCount
        ? {
            archiveId: archiveRows.rows[0].archive_id,
            status: archiveRows.rows[0].status,
            retentionDays: (archiveRows.rows[0].retention_days ?? undefined) as
              | RetentionDays
              | undefined,
            downloadUrl: archiveRows.rows[0].download_url ?? undefined,
            fileSize: archiveRows.rows[0].file_size ?? undefined,
            expiresAt: archiveRows.rows[0].expires_at?.toISOString()
          }
        : {
            status: "not_started"
          },
      createdAt: row.created_at.toISOString(),
      completedAt: row.completed_at?.toISOString() ?? null
    }
  }

  private async assertTaskOwnedByDevice(taskId: string, taskToken: string, deviceId: string) {
    const task = await this.getTaskRecordByToken(taskId, taskToken)

    if (task.device_id && task.device_id !== deviceId) {
      throw new UnauthorizedException("task owned by another device")
    }

    if (!task.device_id) {
      await this.pool.query("update tasks set device_id = $2 where id = $1", [taskId, deviceId])
    }
  }

  private async getTaskRecordByToken(taskId: string, taskToken: string) {
    const rows = await this.pool.query<{
      id: string
      license_id: string
      device_id: string | null
    }>(
      `
        select id, license_id, device_id
        from tasks
        where id = $1 and task_token = $2
      `,
      [taskId, taskToken]
    )

    if (!rows.rowCount) {
      throw new UnauthorizedException("task token invalid")
    }

    return rows.rows[0]
  }

  private async getTaskByIdWithoutAuth(taskId: string) {
    const rows = await this.pool.query<TaskRow>(
      `
        select id, platform, status, source_url, canonical_url, title, product_id, error_code,
               error_message, extractor_version, created_at, completed_at
        from tasks
        where id = $1
      `,
      [taskId]
    )

    if (!rows.rowCount) {
      throw new NotFoundException("task not found")
    }

    return this.hydrateTask(rows.rows[0])
  }

  private async getLicenseByToken(token: string): Promise<License> {
    const rows = await this.pool.query<{
      id: string
      token: string
      duration_days: number
      expires_at: Date
    }>(
      `
        select id, token, duration_days, expires_at
        from licenses
        where token = $1
      `,
      [token]
    )

    if (!rows.rowCount) {
      throw new UnauthorizedException("license not found")
    }

    return {
      licenseId: rows.rows[0].id,
      licenseToken: rows.rows[0].token,
      durationDays: rows.rows[0].duration_days,
      expiresAt: rows.rows[0].expires_at.toISOString()
    }
  }

  private async getDeviceByToken(authorization?: string): Promise<Device> {
    const token = getBearerToken(authorization)
    const rows = await this.pool.query<{
      id: string
      installation_id: string
      status: Device["status"]
      license_id: string | null
      extension_version: string
      last_heartbeat_at: Date | null
    }>(
      `
        select id, installation_id, status, license_id, extension_version, last_heartbeat_at
        from devices
        where device_token = $1
      `,
      [token]
    )

    if (!rows.rowCount) {
      throw new UnauthorizedException("device not found")
    }

    return {
      deviceId: rows.rows[0].id,
      installationId: rows.rows[0].installation_id,
      status: rows.rows[0].status,
      licenseId: rows.rows[0].license_id ?? undefined,
      extensionVersion: rows.rows[0].extension_version,
      lastHeartbeatAt: rows.rows[0].last_heartbeat_at?.toISOString()
    }
  }
}
