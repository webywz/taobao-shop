from fastapi import APIRouter, Header, Request
from typing import Optional
from app.admin_auth import verify_admin_token
from app.store import store

router = APIRouter(prefix="/v1/licenses", tags=["licenses"])

@router.get("/current")
async def get_current_license(authorization: Optional[str] = Header(None)):
    return await store.get_current_license(authorization)

@router.post("/redeem")
async def redeem_license(request: Request):
    input_data = await request.json()
    return await store.redeem_license(input_data["activationCode"])


@router.post("/admin/codes/generate")
async def generate_activation_codes(
    request: Request,
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token")
):
    verify_admin_token(x_admin_token)
    input_data = await request.json()
    count = int(input_data.get("count", 1))
    duration_days = int(input_data.get("durationDays", 30))
    batch_no = input_data.get("batchNo")
    return await store.generate_activation_codes(count=count, duration_days=duration_days, batch_no=batch_no)


@router.get("/admin/codes")
async def list_activation_codes(
    limit: int = 200,
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token")
):
    verify_admin_token(x_admin_token)
    return await store.list_activation_codes(limit=limit)
