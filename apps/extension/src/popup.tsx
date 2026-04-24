import { useEffect, useState } from "react"

import { EXTENSION_VERSION } from "./shared/version"

export default function Popup() {
  const [status, setStatus] = useState("checking")
  const [runtimeVersion, setRuntimeVersion] = useState(EXTENSION_VERSION)
  const [wakeMessage, setWakeMessage] = useState<string | null>(null)

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "PLUGIN_STATUS" }, (response) => {
      if (!response) {
        setStatus("unavailable")
        return
      }

      setStatus(response.bound ? "bound" : "installed")
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
      {wakeMessage ? <p style={{ margin: "8px 0 0" }}>{wakeMessage}</p> : null}
    </div>
  )
}
