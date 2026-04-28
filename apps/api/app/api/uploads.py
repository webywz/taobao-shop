from fastapi import APIRouter, Header, Request
from typing import Optional
from app.store import store

router = APIRouter(prefix="/v1/uploads", tags=["uploads"])

@router.post("/presign")
async def presign_uploads(request: Request, authorization: Optional[str] = Header(None)):
    input_data = await request.json()
    return await store.presign_uploads(input_data, authorization)

@router.post("/complete")
async def complete_uploads(request: Request, authorization: Optional[str] = Header(None)):
    input_data = await request.json()
    return await store.complete_uploads(input_data, authorization)

