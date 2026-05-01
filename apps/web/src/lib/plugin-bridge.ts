"use client"

type BridgeRequestType = "PLUGIN_PING" | "PLUGIN_STATUS" | "TRIGGER_POLL"

type BridgePayloadMap = {
  PLUGIN_PING: Record<string, never>
  PLUGIN_STATUS: Record<string, never>
  TRIGGER_POLL: Record<string, never>
}

type BridgeResponseMap = {
  PLUGIN_PING: {
    installed: boolean
    version?: string
  }
  PLUGIN_STATUS: {
    installed: boolean
    ready: boolean
    deviceId?: string | null
  }
  TRIGGER_POLL: {
    success: boolean
  }
}

function createRequestId() {
  return `req_${Math.random().toString(36).slice(2, 10)}`
}

async function sendBridgeMessage<T extends BridgeRequestType>(
  type: T,
  payload: BridgePayloadMap[T]
): Promise<BridgeResponseMap[T]> {
  if (typeof window === "undefined") {
    throw new Error("当前环境不可用")
  }

  const requestId = createRequestId()

  return new Promise<BridgeResponseMap[T]>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage)
      reject(new Error("插件没有响应"))
    }, 1500)

    function onMessage(event: MessageEvent) {
      const data = event.data as {
        source?: string
        type?: string
        requestId?: string
        payload?: BridgeResponseMap[T]
      }

      if (
        data?.source !== "tb-image-saas-extension" ||
        data.type !== type ||
        data.requestId !== requestId
      ) {
        return
      }

      window.clearTimeout(timeout)
      window.removeEventListener("message", onMessage)
      resolve(data.payload as BridgeResponseMap[T])
    }

    window.addEventListener("message", onMessage)
    window.postMessage(
      {
        source: "tb-image-saas-web",
        type,
        requestId,
        payload
      },
      "*"
    )
  })
}

export async function pingPlugin() {
  return sendBridgeMessage("PLUGIN_PING", {})
}

export async function getPluginStatus() {
  return sendBridgeMessage("PLUGIN_STATUS", {})
}

export async function triggerPluginPoll() {
  return sendBridgeMessage("TRIGGER_POLL", {})
}
