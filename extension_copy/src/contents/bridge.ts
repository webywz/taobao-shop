import type { PlasmoCSConfig } from "plasmo"

import "../content/bridge"

export const config: PlasmoCSConfig = {
  matches: [
    "http://localhost/*",
    "https://localhost/*",
    "http://127.0.0.1/*",
    "https://127.0.0.1/*",
    "https://*/*"
  ]
}
