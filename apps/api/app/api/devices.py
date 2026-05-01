from fastapi import APIRouter, Header, Request
from fastapi.responses import StreamingResponse
from typing import Optional
from app.store import store

router = APIRouter(prefix="/v1/devices", tags=["devices"])

@router.post("/register")
async def register_device(request: Request):
    input_data = await request.json()
    return await store.register_device(input_data)


@router.get("/events")
async def device_events(token: str):
    await store.get_device_by_token(f"Bearer {token}")

    return StreamingResponse(
        store.device_event_stream(token),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )


@router.post("/{device_id}/heartbeat")
async def heartbeat(device_id: str, request: Request, authorization: Optional[str] = Header(None)):
    input_data = await request.json()
    return await store.heartbeat(device_id, input_data, authorization)
