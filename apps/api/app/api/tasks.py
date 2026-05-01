from fastapi import APIRouter, Header, Request, Response
from typing import Optional
from app.store import store

router = APIRouter(prefix="/v1/extract/tasks", tags=["tasks"])

@router.post("")
async def create_task(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token")
):
    input_data = await request.json()
    return await store.create_task(input_data, authorization, x_admin_token)

@router.post("/batch")
async def create_tasks_batch(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token")
):
    input_data = await request.json()
    return await store.create_tasks_batch(input_data, authorization, x_admin_token)

@router.get("")
async def list_tasks(
    authorization: Optional[str] = Header(None),
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token")
):
    items = await store.list_tasks(authorization, x_admin_token)
    return {"items": items, "page": 1, "pageSize": len(items), "total": len(items)}

@router.get("/queue/next")
async def next_task(authorization: Optional[str] = Header(None)):
    task = await store.next_task(authorization)
    if task is None:
        return Response(status_code=204)
    return task

@router.get("/{task_id}")
async def get_task(
    task_id: str,
    authorization: Optional[str] = Header(None),
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token")
):
    return await store.get_task(task_id, authorization, x_admin_token)

@router.post("/{task_id}/claim")
async def claim_task(task_id: str, request: Request, authorization: Optional[str] = Header(None)):
    input_data = await request.json()
    return await store.claim_task(task_id, input_data, authorization)

@router.post("/{task_id}/result")
async def submit_result(task_id: str, request: Request, authorization: Optional[str] = Header(None)):
    input_data = await request.json()
    return await store.submit_result(task_id, input_data, authorization)

@router.post("/{task_id}/progress")
async def update_progress(task_id: str, request: Request, authorization: Optional[str] = Header(None)):
    input_data = await request.json()
    return await store.update_task_progress(task_id, input_data, authorization)

@router.post("/{task_id}/fail")
async def submit_fail(task_id: str, request: Request, authorization: Optional[str] = Header(None)):
    input_data = await request.json()
    return await store.submit_fail(task_id, input_data, authorization)

@router.post("/{task_id}/archive")
async def request_archive(
    task_id: str,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token")
):
    try:
        input_data = await request.json()
    except:
        input_data = {}
    return await store.request_archive(task_id, input_data, authorization, x_admin_token)

@router.get("/{task_id}/archive")
async def get_archive(
    task_id: str,
    authorization: Optional[str] = Header(None),
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token")
):
    return await store.get_archive(task_id, authorization, x_admin_token)

@router.post("/{task_id}/convert")
async def convert_task(
    task_id: str,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token")
):
    input_data = await request.json()
    return await store.convert_task(task_id, input_data, authorization, x_admin_token)
