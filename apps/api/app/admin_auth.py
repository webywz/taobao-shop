import base64
import datetime
import hashlib
import hmac
import os
import secrets
from fastapi import HTTPException


ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
ADMIN_AUTH_SECRET = os.environ.get("ADMIN_AUTH_SECRET", "change-me-in-production")
ADMIN_TOKEN_TTL_SECONDS = int(os.environ.get("ADMIN_TOKEN_TTL_SECONDS", "86400"))


def _utc_now() -> int:
    return int(datetime.datetime.now(datetime.timezone.utc).timestamp())


def _sign(payload: str) -> str:
    return hmac.new(
        ADMIN_AUTH_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()


def create_admin_token(username: str) -> dict:
    expires_at = _utc_now() + ADMIN_TOKEN_TTL_SECONDS
    nonce = secrets.token_hex(8)
    payload = f"{username}:{expires_at}:{nonce}"
    signature = _sign(payload)
    raw = f"{payload}:{signature}"
    token = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8")
    return {
        "token": token,
        "expiresAt": datetime.datetime.fromtimestamp(
            expires_at, tz=datetime.timezone.utc
        ).isoformat()
    }


def verify_admin_token(token: str | None) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="admin authentication required")
    try:
        decoded = base64.urlsafe_b64decode(token.encode("utf-8")).decode("utf-8")
        username, exp_str, nonce, signature = decoded.split(":", 3)
        payload = f"{username}:{exp_str}:{nonce}"
        expected_sig = _sign(payload)
        if not hmac.compare_digest(expected_sig, signature):
            raise HTTPException(status_code=401, detail="invalid admin token")
        if int(exp_str) <= _utc_now():
            raise HTTPException(status_code=401, detail="admin token expired")
        return {"username": username}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail="invalid admin token") from exc


def require_admin_login(username: str, password: str):
    if username != ADMIN_USERNAME or password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="invalid admin credentials")
