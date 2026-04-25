from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import uuid
import time

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
