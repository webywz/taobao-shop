from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import uuid
import time
import time
import re

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

tasks: dict = {}


class CreateTaskRequest(BaseModel):
    url: str


class TaskResult(BaseModel):
    title: Optional[str] = None
    images: list[str] = []
    video_url: Optional[str] = None
    color_images: list[str] = []
    detail_images: list[str] = []
    skus: list[dict] = []
    raw: Optional[dict] = None


class SubmitResultRequest(BaseModel):
    task_id: str
    result: TaskResult
    status: str = "completed"
    error_message: Optional[str] = None


@app.get("/health")
def health():
    return {"ok": True}


def _find_values(obj, keys, max_depth=8, current_depth=0, seen=None):
    if seen is None:
        seen = set()
    
    obj_id = id(obj)
    if obj_id in seen or current_depth > max_depth:
        return []
    
    seen.add(obj_id)
    results = []

    if isinstance(obj, dict):
        for k, v in obj.items():
            if any(re.search(key_pattern, k, re.IGNORECASE) for key_pattern in keys):
                if v:
                    results.append(v)
            results.extend(_find_values(v, keys, max_depth, current_depth + 1, seen))
    elif isinstance(obj, list):
        for item in obj:
            results.extend(_find_values(item, keys, max_depth, current_depth + 1, seen))
            
    return results

def enhance_result_from_page_data(result: TaskResult):
    if not result.raw or not isinstance(result.raw, dict):
        return
    
    page_data = result.raw.get("page_data")
    if not page_data or not isinstance(page_data, dict):
        return

    # Extract title
    if not result.title or result.title == "undefined":
        titles = _find_values(page_data, [r'^title$', r'^itemTitle$'])
        for t in titles:
            if isinstance(t, str) and len(t) > 5:
                result.title = t
                break

    # Extract main images
    if not result.images or len(result.images) == 0:
        images_lists = _find_values(page_data, [r'^images$', r'^auctionImages$', r'^picUrls$', r'^picList$'])
        for lst in images_lists:
            if isinstance(lst, list) and len(lst) > 0 and isinstance(lst[0], str):
                valid_images = [img if img.startswith('http') else f"https:{img}" for img in lst if isinstance(img, str) and not img.endswith('.gif')]
                if valid_images:
                    result.images = valid_images
                    break

    # Extract video url
    if not result.video_url:
        videos = _find_values(page_data, [r'^videoUrl$', r'^video$'])
        for v in videos:
            if isinstance(v, str) and ('.mp4' in v or '.m3u8' in v):
                result.video_url = v if v.startswith('http') else f"https:{v}"
                break
            elif isinstance(v, dict) and isinstance(v.get('url'), str) and '.mp4' in v.get('url'):
                url = v.get('url')
                result.video_url = url if url.startswith('http') else f"https:{url}"
                break

    # Extract skus
    if not result.skus or len(result.skus) == 0:
        # Looking for props and propertyPics
        props_list = _find_values(page_data, [r'^props$', r'^skuProps$'])
        property_pics_list = _find_values(page_data, [r'^propertyPics$', r'^sku2info$'])
        
        # A simple fallback sku extraction based on property pics if detailed extraction fails
        for pics in property_pics_list:
            if isinstance(pics, dict):
                for k, v in pics.items():
                    pic_url = None
                    if isinstance(v, str):
                        pic_url = v
                    elif isinstance(v, list) and len(v) > 0 and isinstance(v[0], str):
                        pic_url = v[0]
                    elif isinstance(v, dict) and isinstance(v.get('picUrl', v.get('pic')), str):
                        pic_url = v.get('picUrl', v.get('pic'))
                        
                    if pic_url:
                        pic_url = pic_url if pic_url.startswith('http') else f"https:{pic_url}"
                        # Try to find a matching name in props, or just use the ID
                        result.skus.append({"name": f"SKU {k}", "image": pic_url})
                if result.skus:
                    break

    # Remove duplicates from images
    if result.images:
        result.images = list(dict.fromkeys(result.images))
    if result.skus:
        # Just extracting images for color_images
        result.color_images = list(dict.fromkeys([sku['image'] for sku in result.skus if sku.get('image')]))

    # Extract detail images from HTML contents and network responses in page_data
    network_responses = page_data.get('__tbtNetworkResponses', [])
    detail_images_list = []
    
    html_contents = _find_values(page_data, [r'^pcDescContent$', r'^mobileDescContent$', r'^wdescContent$', r'^descContent$', r'^descriptionHtml$', r'^singleHtml$'])
    
    if isinstance(network_responses, list):
        for resp in network_responses:
            if isinstance(resp, dict) and resp.get('likelyDetail'):
                html_contents.append(resp.get('body', ''))

    def extract_images_from_html(html_str):
        if not isinstance(html_str, str):
            return []
        # Support src="", data-src="", and raw urls
        urls = re.findall(r'(?:src|data-ks-lazyload|data-lazyload|data-src|data-lazy-src)=["\']([^"\']+\.(?:jpg|jpeg|png|webp|gif|bmp|avif)[^"\']*)["\']', html_str, re.IGNORECASE)
        urls2 = re.findall(r'(?:https?:)?\/\/[^"\'\\<>\s]+?\.(?:jpg|jpeg|png|webp|gif|bmp|avif)', html_str, re.IGNORECASE)
        
        valid = []
        for u in urls + urls2:
            if 'sprite' in u or 'icon' in u or 'logo' in u or '.gif' in u:
                continue
            if u.startswith('//'):
                u = f"https:{u}"
            elif not u.startswith('http'):
                continue
            # Remove url parameters if needed, but let's keep it simple
            valid.append(u)
        return valid

    for html in html_contents:
        if isinstance(html, str):
            detail_images_list.extend(extract_images_from_html(html))
        elif isinstance(html, dict):
            pages = html.get('pages', [])
            if isinstance(pages, list):
                for p in pages:
                    detail_images_list.extend(extract_images_from_html(p))

    if detail_images_list:
        unique_detail_images = list(dict.fromkeys(detail_images_list))
        main_and_color = set(result.images + result.color_images)
        final_details = [u for u in unique_detail_images if u not in main_and_color]
        
        # If the newly extracted detail images are more than what we have, update it.
        # Especially when JS only returned 3 images.
        if len(final_details) > len(result.detail_images) or len(result.detail_images) <= 3:
            if final_details:
                result.detail_images = final_details


@app.post("/tasks")
def create_task(req: CreateTaskRequest):
    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "id": task_id,
        "url": req.url,
        "status": "pending",
        "created_at": time.time(),
        "updated_at": time.time(),
        "result": None,
        "error_message": None,
    }
    return {"task_id": task_id, "status": "pending"}


@app.get("/tasks")
def list_tasks(status: Optional[str] = None):
    result = list(tasks.values())
    if status:
        result = [t for t in result if t["status"] == status]
    result.sort(key=lambda t: t["created_at"], reverse=True)
    return {"total": len(result), "tasks": result}

@app.post("/tasks/{task_id}/status")
def update_task_status(task_id: str, status: str):
    task = tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    task["status"] = status
    task["updated_at"] = time.time()
    return {"ok": True}


@app.get("/tasks/{task_id}")
def get_task(task_id: str):
    task = tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@app.post("/tasks/{task_id}/result")
def submit_result(task_id: str, req: SubmitResultRequest):
    task = tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
        
    enhance_result_from_page_data(req.result)
    
    task["status"] = req.status
    task["result"] = req.result.model_dump()
    task["error_message"] = req.error_message
    task["updated_at"] = time.time()
    return {"ok": True}


@app.delete("/tasks/{task_id}")
def delete_task(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="task not found")
    del tasks[task_id]
    return {"ok": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=4318)
