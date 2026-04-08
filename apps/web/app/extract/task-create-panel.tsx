"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { createTask, getStoredLicenseToken } from "../lib/api"
import { getPluginStatus, pingPlugin, triggerPluginPoll } from "../lib/plugin-bridge"

export function TaskCreatePanel() {
  const router = useRouter()
  const [sourceUrl, setSourceUrl] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleCreate() {
    if (!getStoredLicenseToken()) {
      setMessage("请先完成卡密激活")
      return
    }

    const normalizedUrl = sourceUrl.trim()

    if (!normalizedUrl) {
      setMessage("请输入商品链接")
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      const result = await createTask({
        sourceUrl: normalizedUrl
      })

      try {
        await triggerPluginPoll()
      } catch {
        // The task is already created. Do not block navigation if the plugin does not respond.
      }

      router.push(`/tasks/${result.taskId}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建任务失败")
    } finally {
      setLoading(false)
    }
  }

  async function handlePluginStatus() {
    try {
      const ping = await pingPlugin()
      const status = await getPluginStatus()
      setMessage(
        status.installed
          ? status.bound
            ? `插件已安装，版本 ${ping.version ?? "-"}，设备 ${status.deviceId ?? "-"} 已绑定`
            : `插件已安装，版本 ${ping.version ?? "-"}，但还没有绑定当前 license`
          : "插件未安装"
      )
    } catch {
      setMessage("未收到插件响应，请确认 content bridge 已注入当前页面")
    }
  }

  return (
    <div className="grid">
      <input
        className="field"
        placeholder="https://item.taobao.com/item.htm?id=123456"
        value={sourceUrl}
        onChange={(event) => setSourceUrl(event.target.value)}
      />
      <div className="row">
        <button className="button" onClick={handleCreate} disabled={loading}>
          {loading ? "创建中..." : "开始提取"}
        </button>
        <button className="button secondary" onClick={handlePluginStatus}>
          检查插件状态
        </button>
      </div>
      <div className="meta-row">
        <div className="meta-chip">支持淘宝 / 天猫 / 拼多多</div>
        <div className="meta-chip">创建任务后立即通知插件拉取</div>
      </div>
      {message ? <div className="message-box">{message}</div> : null}
    </div>
  )
}
