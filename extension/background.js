const BACKEND_URL = "http://127.0.0.1:4318";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "COLLECT_RESULT") {
    submitResult(msg.taskId, msg.data).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

async function submitResult(taskId, data) {
  const resp = await fetch(`${BACKEND_URL}/tasks/${taskId}/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task_id: taskId,
      result: data,
      status: data.error ? "failed" : "completed",
      error_message: data.error || null,
    }),
  });
  return resp.json();
}

chrome.runtime.onConnectExternal.addListener((port) => {
  port.onMessage.addListener(async (msg) => {
    if (msg.type === "OPEN_AND_COLLECT") {
      const { taskId, url } = msg;
      const tab = await chrome.tabs.create({ url, active: false });
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: collectAndReport,
            args: [taskId, BACKEND_URL],
          });
        }
      });
      port.postMessage({ ok: true, taskId });
    }
  });
});

function collectAndReport(taskId, backendUrl) {
  function getText(sel) {
    const el = document.querySelector(sel);
    return el ? el.innerText.trim() : null;
  }

  const title = getText(".mainTitle") || getText('[data-spm="title"]') || document.title;
  const priceText = getText(".priceText") || getText(".tb-rmb-num") || getText('[class*="price"]');
  const shopName = getText(".shopName") || getText('[class*="shop-name"]');

  const images = Array.from(document.querySelectorAll(".mainPicList img, .tb-thumb img"))
    .map(img => img.src || img.dataset.src)
    .filter(Boolean)
    .slice(0, 10);

  const result = { title, price_text: priceText, shop_name: shopName, images, skus: [], raw: null };

  fetch(`${backendUrl}/tasks/${taskId}/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: taskId, result, status: "completed" }),
  });
}
