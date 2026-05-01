import { extractProductFromPage } from "./extract-product"

type BridgeMessage =
  | {
      source: "tb-image-saas-web"
      type: "PLUGIN_PING"
      requestId: string
      payload: Record<string, never>
    }
  | {
      source: "tb-image-saas-web"
      type: "PLUGIN_STATUS"
      requestId: string
      payload: Record<string, never>
    }
  | {
      source: "tb-image-saas-web"
      type: "TRIGGER_POLL"
      requestId: string
      payload: Record<string, never>
    }

type RuntimeExtractMessage = {
  type: "EXTRACT_PRODUCT_IMAGES"
  payload: Record<string, never>
}

function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    candidate.source === "tb-image-saas-web" &&
    typeof candidate.type === "string" &&
    typeof candidate.requestId === "string"
  )
}

window.addEventListener("message", (event) => {
  if (event.source !== window || !isBridgeMessage(event.data)) {
    return
  }

  chrome.runtime.sendMessage(
    {
      type: event.data.type,
      payload: event.data.payload
    },
    (response) => {
      window.postMessage(
        {
          source: "tb-image-saas-extension",
          type: event.data.type,
          requestId: event.data.requestId,
          payload: response ?? {
            success: false
          }
        },
        "*"
      )
    }
  )
})

chrome.runtime.onMessage.addListener((message: RuntimeExtractMessage, _sender, sendResponse) => {
  if (message?.type !== "EXTRACT_PRODUCT_IMAGES") {
    return false
  }

  void (async () => {
    try {
      const payload = await extractProductFromPage()
      sendResponse({
        success: true,
        payload
      })
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "extract failed"
      })
    }
  })()

  return true
})
