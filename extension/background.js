const BACKEND_URL = "http://127.0.0.1:4318";

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
        
        chrome.tabs.create({ url: urlObj.toString(), active: false });
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
    chrome.tabs.remove(sender.tab.id);
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
