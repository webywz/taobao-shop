"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { redeemLicense } from "../lib/api"
import { bindCurrentLicenseToPlugin, pingPlugin } from "../lib/plugin-bridge"

export function ActivateForm() {
  const router = useRouter()
  const [activationCode, setActivationCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleSubmit() {
    setLoading(true)
    setMessage(null)

    try {
      const license = await redeemLicense(activationCode.trim().toUpperCase())
      try {
        const ping = await pingPlugin()

        if (ping.installed) {
          const bindResult = await bindCurrentLicenseToPlugin()
          setMessage(
            bindResult.success
              ? `激活成功并完成插件绑定，有效期 ${license.durationDays} 天`
              : `激活成功，有效期 ${license.durationDays} 天，请手动检查插件绑定`
          )
        } else {
          setMessage(`激活成功，有效期 ${license.durationDays} 天，请先安装插件`)
        }
      } catch {
        setMessage(`激活成功，有效期 ${license.durationDays} 天，请确认插件已安装`)
      }

      router.push("/extract")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "激活失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid">
      <input
        className="field"
        placeholder="ABCD-EFGH-JKLM-NPQR"
        value={activationCode}
        onChange={(event) => setActivationCode(event.target.value)}
      />
      <div className="row">
        <button className="button" onClick={handleSubmit} disabled={loading}>
          {loading ? "激活中..." : "激活并继续"}
        </button>
        <button
          className="button secondary"
          onClick={() => setActivationCode("")}
          type="button"
        >
          清空输入
        </button>
      </div>
      {message ? <div className="message-box">{message}</div> : null}
    </div>
  )
}
