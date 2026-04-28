from fastapi import APIRouter, Header, Request
from typing import Optional
from app.store import store

router = APIRouter(prefix="/v1/devices", tags=["devices"])

@router.post("/register")
async def register_device(request: Request):
    input_data = await request.json()
    return await store.register_device(input_data)

@router.post("/{device_id}/bind")
async def bind_license(device_id: str, request: Request):
    input_data = await request.json()
    return await store.bind_license(device_id, input_data)

@router.post("/{device_id}/heartbeat")
async def heartbeat(device_id: str, request: Request, authorization: Optional[str] = Header(None)):
    input_data = await request.json()
    return await store.heartbeat(device_id, input_data, authorization)

