const BACKEND_URL = "http://127.0.0.1:4318";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientTabEditError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("tabs cannot be edited right now") ||
    message.includes("dragging a tab")
  );
}

async function withTabEditRetry(action, attempts = 4) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isTransientTabEditError(error) || index === attempts - 1) {
        throw error;
      }
      await sleep(400 * (index + 1));
    }
  }
  throw lastError;
}

async function pollTasks() {
  try {
    const resp = await fetch(`${BACKEND_URL}/tasks?status=pending`);
    if (!resp.ok) return;
    const data = await resp.json();
    
    if (data.tasks && data.tasks.length > 0) {
      for (const task of data.tasks) {
        // Mark as running
        await fetch(`${BACKEND_URL}/tasks/${task.id}/status?status=running`, {
          method: "POST",
        });
        
        // Open tab with __task_id
        let urlObj = new URL(task.url);
        urlObj.searchParams.set("__task_id", task.id);

        await withTabEditRetry(() => chrome.tabs.create({ url: urlObj.toString(), active: false }));
      }
    }
  } catch (err) {
    // Backend might be offline, ignore
  }
}

// Poll every 3 seconds
setInterval(pollTasks, 3000);
pollTasks();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "COLLECT_RESULT") {
    submitResult(msg.taskId, msg.data).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "CLOSE_TAB" && sender.tab) {
    withTabEditRetry(() => chrome.tabs.remove(sender.tab.id)).catch(() => {});
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
