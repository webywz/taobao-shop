import { useEffect, useState } from "react"

import { EXTENSION_VERSION } from "./shared/version"

export default function Popup() {
  const [status, setStatus] = useState("checking")
  const [runtimeVersion, setRuntimeVersion] = useState(EXTENSION_VERSION)
  const [wakeMessage, setWakeMessage] = useState<string | null>(null)
  const [pddWorkTabBound, setPddWorkTabBound] = useState(false)
  const [pddMessage, setPddMessage] = useState<string | null>(null)
  const [pddDiagnosis, setPddDiagnosis] = useState<string | null>(null)

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "PLUGIN_STATUS" }, (response) => {
      if (!response) {
        setStatus("unavailable")
        return
      }

      setStatus(response.bound ? "bound" : "installed")
      setPddWorkTabBound(Boolean(response.pddWorkTabBound))
    })

    chrome.runtime.sendMessage({ type: "PLUGIN_PING" }, (response) => {
      if (response?.version) {
        setRuntimeVersion(response.version)
      }
    })
  }, [])

  async function handleWakePage() {
    setWakeMessage(null)

    try {
      await chrome.runtime.sendMessage({ type: "TRIGGER_POLL" })
    } catch {
      // Ignore polling failures and keep the page wake path available.
    }

    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    })

    if (!activeTab?.id || !activeTab.url) {
      setWakeMessage("没有找到当前标签页")
      return
    }

    try {
      const url = new URL(activeTab.url)

      if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
        setWakeMessage("请先切回本地调试页面")
        return
      }

      await chrome.tabs.reload(activeTab.id)
      setWakeMessage("当前页面已刷新，请回到网页重新检测插件")
    } catch {
      setWakeMessage("当前标签页地址不可用")
    }
  }

  async function refreshPluginStatus() {
    const response = await chrome.runtime.sendMessage({ type: "PLUGIN_STATUS" })

    if (!response) {
      setStatus("unavailable")
      setPddWorkTabBound(false)
      return
    }

    setStatus(response.bound ? "bound" : "installed")
    setPddWorkTabBound(Boolean(response.pddWorkTabBound))
  }

  async function handleBindPddWorkTab() {
    setPddMessage(null)
    setPddDiagnosis(null)

    try {
      const response = await chrome.runtime.sendMessage({
        type: "BIND_PDD_WORK_TAB"
      })

      if (!response?.success) {
        setPddMessage(response?.error || "绑定失败")
        return
      }

      await refreshPluginStatus()
      setPddMessage("当前拼多多页已绑定为工作页，请在这个页里保持登录")
    } catch {
      setPddMessage("绑定拼多多工作页失败")
    }
  }

  async function handleOpenPddWorkTab() {
    setPddMessage(null)
    setPddDiagnosis(null)

    try {
      const response = await chrome.runtime.sendMessage({
        type: "OPEN_PDD_WORK_TAB"
      })

      if (!response?.success) {
        setPddMessage(response?.error || "打开失败")
        return
      }

      setPddMessage("已切回拼多多工作页")
    } catch {
      setPddMessage("打开拼多多工作页失败")
    }
  }

  async function handleDiagnosePddWorkTab() {
    setPddMessage(null)
    setPddDiagnosis("诊断中...")

    try {
      const response = await chrome.runtime.sendMessage({
        type: "DIAGNOSE_PDD_WORK_TAB"
      })

      if (!response?.success) {
        const details = [response?.error, response?.url, response?.title].filter(Boolean).join(" | ")
        setPddDiagnosis(details || "诊断失败")
        return
      }

      const counts = response.counts as {
        main: number
        sku: number
        detail: number
        other: number
      }

      setPddDiagnosis(
        [
          `成功`,
          response.url,
          response.productId ? `goodsId=${response.productId}` : "goodsId=空",
          `main=${counts.main}`,
          `sku=${counts.sku}`,
          `detail=${counts.detail}`,
          `other=${counts.other}`
        ].join(" | ")
      )
    } catch {
      setPddDiagnosis("诊断拼多多工作页失败")
    }
  }

  return (
    <div
      style={{
        minWidth: 280,
        padding: 16,
        fontFamily: "Arial, sans-serif"
      }}>
      <h1 style={{ fontSize: 16, margin: "0 0 12px" }}>插件状态</h1>
      <p style={{ margin: 0 }}>当前状态：{status}</p>
      <p style={{ margin: "8px 0 0" }}>插件版本：{runtimeVersion}</p>
      <p style={{ margin: "8px 0 0" }}>
        拼多多工作页：{pddWorkTabBound ? "已绑定" : "未绑定"}
      </p>
      <button
        type="button"
        onClick={handleBindPddWorkTab}
        style={{
          marginTop: 12,
          border: "1px solid #cfd8de",
          borderRadius: 12,
          background: "#fff",
          padding: "10px 12px",
          cursor: "pointer"
        }}
      >
        绑定当前拼多多页
      </button>
      <button
        type="button"
        onClick={handleOpenPddWorkTab}
        style={{
          marginTop: 12,
          marginLeft: 8,
          border: "1px solid #cfd8de",
          borderRadius: 12,
          background: "#fff",
          padding: "10px 12px",
          cursor: "pointer"
        }}
      >
        打开工作页
      </button>
      <button
        type="button"
        onClick={handleDiagnosePddWorkTab}
        style={{
          marginTop: 12,
          border: "1px solid #cfd8de",
          borderRadius: 12,
          background: "#fff",
          padding: "10px 12px",
          cursor: "pointer"
        }}
      >
        测试当前拼多多工作页
      </button>
      <button
        type="button"
        onClick={handleWakePage}
        style={{
          marginTop: 12,
          border: "1px solid #cfd8de",
          borderRadius: 12,
          background: "#fff",
          padding: "10px 12px",
          cursor: "pointer"
        }}
      >
        唤醒当前页面
      </button>
      {pddMessage ? <p style={{ margin: "8px 0 0" }}>{pddMessage}</p> : null}
      {pddDiagnosis ? <p style={{ margin: "8px 0 0", wordBreak: "break-all" }}>{pddDiagnosis}</p> : null}
      {wakeMessage ? <p style={{ margin: "8px 0 0" }}>{wakeMessage}</p> : null}
    </div>
  )
}
