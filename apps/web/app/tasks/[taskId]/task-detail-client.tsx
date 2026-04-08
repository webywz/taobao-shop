"use client"

import { useEffect, useState } from "react"
import type { Task } from "@tb-pdd-image/shared"

import { convertAsset, convertTask, getTask, requestArchive } from "../../lib/api"

const terminalStatuses = new Set(["completed", "failed", "expired"])

function formatStatus(status: Task["status"]) {
  switch (status) {
    case "pending":
      return "待执行"
    case "claimed":
      return "已领取"
    case "running":
      return "执行中"
    case "uploading":
      return "上传中"
    case "completed":
      return "已完成"
    case "failed":
      return "失败"
    case "expired":
      return "已过期"
    default:
      return status
  }
}

function AssetPreviewSection({
  title,
  emptyText,
  assets,
  brokenAssetIds,
  onAssetError,
  onPreview
}: {
  title: string
  emptyText: string
  assets: Task["assets"]["main"]
  brokenAssetIds: string[]
  onAssetError: (assetId: string) => void
  onPreview: (asset: Task["assets"]["main"][number]) => void
}) {
  const safeAssets = assets ?? []

  return (
    <section className="panel">
      <h2>{title}</h2>
      <ul className="preview-grid">
        {safeAssets.length ? (
          safeAssets.map((asset) => (
            <li key={asset.assetId} className="preview-card">
              {brokenAssetIds.includes(asset.assetId) ? (
                <div className="preview-fallback">
                  <p className="muted">图片预览失败</p>
                </div>
              ) : (
                <button
                  type="button"
                  className="preview-button"
                  onClick={() => onPreview(asset)}
                >
                  <img
                    className="preview-image"
                    src={asset.previewUrl ?? asset.sourceUrl}
                    alt={asset.skuName ?? asset.assetId}
                    loading="lazy"
                    onError={() => onAssetError(asset.assetId)}
                  />
                </button>
              )}
              <div className="preview-meta">
                <strong>{asset.skuName ?? asset.assetId}</strong>
                <span className="muted">
                  {asset.width ?? "-"} × {asset.height ?? "-"}
                </span>
                <a href={asset.sourceUrl} target="_blank" rel="noreferrer" className="preview-link">
                  打开原图 →
                </a>
              </div>
            </li>
          ))
        ) : (
          <li className="preview-card" style={{ padding: 20 }}>{emptyText}</li>
        )}
      </ul>
    </section>
  )
}

export function TaskDetailClient({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<Task | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [brokenAssetIds, setBrokenAssetIds] = useState<string[]>([])
  const [selectedAsset, setSelectedAsset] = useState<Task["assets"]["main"][number] | null>(null)

  useEffect(() => {
    let disposed = false
    let timer: number | undefined

    async function load() {
      try {
        const nextTask = await getTask(taskId)

        if (disposed) {
          return
        }

        setTask(nextTask)
        setError(null)
        setBrokenAssetIds([])

        if (!terminalStatuses.has(nextTask.status)) {
          timer = window.setTimeout(load, 2000)
        }
      } catch (loadError) {
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : "获取任务失败")
        }
      }
    }

    void load()

    return () => {
      disposed = true
      if (timer) {
        window.clearTimeout(timer)
      }
    }
  }, [taskId])

  if (error) {
    return <section className="panel">{error}</section>
  }

  if (!task) {
    return <section className="panel">任务加载中...</section>
  }

  const currentTask = task

  async function handleArchive(retentionDays: 3 | 7 | 30) {
    try {
      await requestArchive(taskId, retentionDays)
      const nextTask = await getTask(taskId)
      setTask(nextTask)
      setActionMessage(`✅ ZIP 已生成，保留 ${retentionDays} 天`)
    } catch (archiveError) {
      setActionMessage(archiveError instanceof Error ? archiveError.message : "ZIP 生成失败")
    }
  }

  async function handleConvertMain() {
    try {
      const result = await convertTask(taskId, {
        assetType: "main",
        targetFormat: "webp",
        retentionDays: 7
      })
      setActionMessage(`✅ 主图转换任务已创建，共 ${String(result.jobCount)} 张`)
    } catch (convertError) {
      setActionMessage(convertError instanceof Error ? convertError.message : "主图转换失败")
    }
  }

  async function handleConvertFirstAsset() {
    const firstAsset = currentTask.assets.main[0]

    if (!firstAsset) {
      setActionMessage("当前没有可转换的主图")
      return
    }

    try {
      await convertAsset(firstAsset.assetId, {
        targetFormat: "png",
        retentionDays: 7
      })
      setActionMessage(`✅ 已为 ${firstAsset.assetId} 创建单图转换任务`)
    } catch (convertError) {
      setActionMessage(convertError instanceof Error ? convertError.message : "单图转换失败")
    }
  }

  function markAssetBroken(assetId: string) {
    setBrokenAssetIds((current) => (current.includes(assetId) ? current : [...current, assetId]))
  }

  function openPreview(asset: Task["assets"]["main"][number]) {
    setSelectedAsset(asset)
  }

  return (
    <>
      <div className="grid two">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-tagline">⚙️ Status</div>
              <h2>任务状态</h2>
            </div>
            <span className="status-pill" data-status={currentTask.status}>
              {formatStatus(currentTask.status)}
            </span>
          </div>
          <ul className="list">
            <li>
              <strong>🌐 平台</strong>
              {task.platform}
            </li>
            <li>
              <strong>📦 提取器版本</strong>
              {currentTask.extractorVersion ?? "-"}
            </li>
            <li>
              <strong>🗂️ ZIP 状态</strong>
              {currentTask.archive.status}
            </li>
            <li>
              <strong>⏰ ZIP 保留期</strong>
              {currentTask.archive.retentionDays ?? "-"} 天
            </li>
          </ul>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-tagline">📊 Summary</div>
              <h2>结果摘要</h2>
            </div>
          </div>
          <ul className="list">
            <li>
              <strong>🖼️ 主图</strong>
              {currentTask.counts.main} 张
            </li>
            <li>
              <strong>📄 详情图</strong>
              {currentTask.counts.detail} 张
            </li>
            <li>
              <strong>📎 其他图片</strong>
              {currentTask.counts.other} 张
            </li>
          </ul>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-tagline">🔧 Actions</div>
            <h2>任务动作</h2>
            <p>只在任务已经产生可用图片后，再触发归档或格式转换。</p>
          </div>
        </div>
        <div className="row">
          <button className="button" onClick={() => handleArchive(7)}>
            📦 生成 ZIP
          </button>
          <button className="button secondary" onClick={handleConvertMain}>
            🔄 主图转 WebP
          </button>
          <button className="button secondary" onClick={handleConvertFirstAsset}>
            🖼️ 首张主图转 PNG
          </button>
        </div>
        {actionMessage ? <div className="message-box">{actionMessage}</div> : null}
      </section>
      <AssetPreviewSection
        title="🖼️ 主图预览"
        emptyText="当前还没有主图结果。"
        assets={currentTask.assets.main}
        brokenAssetIds={brokenAssetIds}
        onAssetError={markAssetBroken}
        onPreview={openPreview}
      />
      <AssetPreviewSection
        title="📄 详情图预览"
        emptyText="当前还没有详情图结果。"
        assets={currentTask.assets.detail}
        brokenAssetIds={brokenAssetIds}
        onAssetError={markAssetBroken}
        onPreview={openPreview}
      />
      <AssetPreviewSection
        title="📎 其他图片预览"
        emptyText="当前还没有其他图片结果。"
        assets={currentTask.assets.other}
        brokenAssetIds={brokenAssetIds}
        onAssetError={markAssetBroken}
        onPreview={openPreview}
      />
      {selectedAsset ? (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setSelectedAsset(null)}>
          <div className="lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="lightbox-close"
              onClick={() => setSelectedAsset(null)}
            >
              ✕ 关闭
            </button>
            <div className="lightbox-stage">
              <img
                className="lightbox-image"
                src={selectedAsset.previewUrl ?? selectedAsset.sourceUrl}
                alt={selectedAsset.skuName ?? selectedAsset.assetId}
              />
            </div>
            <div className="preview-meta">
              <strong>{selectedAsset.skuName ?? selectedAsset.assetId}</strong>
              <span className="muted">
                {selectedAsset.width ?? "-"} × {selectedAsset.height ?? "-"}
              </span>
              <a
                href={selectedAsset.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="preview-link"
              >
                在新窗口打开原图 →
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
