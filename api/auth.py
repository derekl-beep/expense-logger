import os
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS_DEFAULT = 1
TOKEN_EXPIRE_DAYS_REMEMBER = 30

bearer = HTTPBearer()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(user_id: int, remember: bool = False) -> str:
    days = TOKEN_EXPIRE_DAYS_REMEMBER if remember else TOKEN_EXPIRE_DAYS_DEFAULT
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(days=days),
    }
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=ALGORITHM)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> int:
    try:
        payload = jwt.decode(
            credentials.credentials, os.environ["JWT_SECRET"], algorithms=[ALGORITHM]
        )
        return int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
