const BACKEND_URL = "http://127.0.0.1:4318";

(function () {
  const taskId = new URLSearchParams(location.search).get("__task_id");
  if (!taskId) return;

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

  fetch(`${BACKEND_URL}/tasks/${taskId}/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task_id: taskId,
      result: { title, price_text: priceText, shop_name: shopName, images, skus: [] },
      status: "completed",
    }),
  });
})();
