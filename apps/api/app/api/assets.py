from fastapi import APIRouter, Header, Request
from typing import Optional
from app.store import store

router = APIRouter(prefix="/v1/assets", tags=["assets"])

@router.post("/{asset_id}/convert")
async def convert_asset(asset_id: str, request: Request, authorization: Optional[str] = Header(None)):
    input_data = await request.json()
    return await store.convert_asset(asset_id, input_data, authorization)

