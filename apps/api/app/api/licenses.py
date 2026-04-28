from fastapi import APIRouter, Header, Request
from typing import Optional
from app.store import store

router = APIRouter(prefix="/v1/licenses", tags=["licenses"])

@router.get("/current")
async def get_current_license(authorization: Optional[str] = Header(None)):
    return await store.get_current_license(authorization)

@router.post("/redeem")
async def redeem_license(request: Request):
    input_data = await request.json()
    return await store.redeem_license(input_data["activationCode"])

