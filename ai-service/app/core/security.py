"""This service is internal: only the Node backend calls it, using a shared key header."""
import hmac

from fastapi import Header, HTTPException

from app.core.config import get_settings


def require_internal_key(x_internal_key: str = Header(default="")) -> None:
    expected = get_settings().ai_service_key
    if not hmac.compare_digest(x_internal_key.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Invalid internal service key")
