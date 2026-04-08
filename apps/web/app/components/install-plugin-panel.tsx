"use client"

import { useState } from "react"

import { bindCurrentLicenseToPlugin, getPluginStatus, pingPlugin } from "../lib/plugin-bridge"
import { getStoredLicenseToken } from "../lib/api"

export function InstallPluginPanel() {
  const [message, setMessage] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [binding, setBinding] = useState(false)

  async function handleCheck() {
    setChecking(true)

    try {
      const ping = await pingPlugin()

      if (!ping.installed) {
        setMessage("插件没有响应，请先下载插件包并在 Chrome 扩展管理页完成安装。")
        return
      }

      const status = await getPluginStatus()
      setMessage(
        status.bound
          ? `✅ 插件已安装，版本 ${ping.version ?? "-"}，设备 ${status.deviceId ?? "-"} 已绑定`
          : `⚠️ 插件已安装，版本 ${ping.version ?? "-"}，但当前 license 还没有绑定到插件`
      )
    } catch {
      setMessage("当前页面没有收到插件响应。请确认已开启开发者模式，并加载了解压后的插件目录。")
    } finally {
      setChecking(false)
    }
  }

  async function handleBind() {
    const licenseToken = getStoredLicenseToken()

    if (!licenseToken) {
      setMessage("请先完成卡密激活，再绑定插件。")
      return
    }

    setBinding(true)

    try {
      const result = await bindCurrentLicenseToPlugin()
      setMessage(result.success ? "✅ 插件绑定成功，可以开始提取任务。" : "❌ 插件绑定失败，请检查插件是否正常安装。")
    } catch {
      setMessage("插件绑定失败，请确认页面已能检测到插件响应。")
    } finally {
      setBinding(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-tagline">🔌 Plugin</div>
          <h2>安装、检测并绑定扩展</h2>
          <p>下载 ZIP，加载目录，回到页面检测并绑定。</p>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 20 }}>
        <a className="button" href="/downloads/tb-pdd-image-extension.zip" download>
          📥 下载插件包
        </a>
        <button className="button secondary" onClick={handleCheck} disabled={checking}>
          {checking ? "检测中..." : "🔍 检测插件"}
        </button>
        <button className="button secondary" onClick={handleBind} disabled={binding}>
          {binding ? "绑定中..." : "🔗 绑定当前 License"}
        </button>
      </div>
      <ul className="list">
        <li>
          <strong>① 下载解压</strong>
          下载并解压，保留 `chrome-mv3-prod` 目录。
        </li>
        <li>
          <strong>② 加载插件</strong>
          打开 `chrome://extensions`，开启开发者模式，加载已解压目录。
        </li>
        <li>
          <strong>③ 检测绑定</strong>
          回到页面检测插件，再绑定当前 License。
        </li>
      </ul>
      {message ? <div className="message-box">{message}</div> : null}
    </section>
  )
}
