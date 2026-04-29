from fastapi import APIRouter, Request, Header
from typing import Optional
from app.admin_auth import create_admin_token, require_admin_login, verify_admin_token

router = APIRouter(prefix="/v1/admin", tags=["admin"])


@router.post("/login")
async def admin_login(request: Request):
    input_data = await request.json()
    username = str(input_data.get("username", "")).strip()
    password = str(input_data.get("password", ""))
    require_admin_login(username, password)
    token_payload = create_admin_token(username)
    return {
        "username": username,
        "token": token_payload["token"],
        "expiresAt": token_payload["expiresAt"]
    }


@router.get("/me")
async def admin_me(x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token")):
    admin = verify_admin_token(x_admin_token)
    return {"username": admin["username"]}
