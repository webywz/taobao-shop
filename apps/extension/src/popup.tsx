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

      setStatus(response.ready ? "ready" : "installed")
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
      const response = await chrome.runtime.sendMessage({ type: "TRIGGER_POLL" })

      if (response?.success === false) {
        setWakeMessage(response.errorMessage || "插件拉取任务失败")
        return
      }

      setWakeMessage("已请求插件立即拉取任务")
    } catch {
      setWakeMessage("插件拉取任务失败，请检查后端服务是否已启动")
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
        立即拉取任务
      </button>
      {wakeMessage ? <p style={{ margin: "8px 0 0" }}>{wakeMessage}</p> : null}
    </div>
  )
}
