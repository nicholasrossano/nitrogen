from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
import os

from app.config import get_settings

settings = get_settings()
security = HTTPBearer(auto_error=False)


class MockUser:
    """Mock user for development without Firebase"""
    def __init__(self, uid: str = "dev-user-001"):
        self.uid = uid
        self.email = "dev@wisterion.local"


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> MockUser:
    """
    Get current user from Firebase token or return mock user in dev mode.
    
    In production, this would verify the Firebase ID token.
    For MVP, we use a mock user to simplify development.
    """
    # If no Firebase project configured, use mock user
    if not settings.firebase_project_id:
        return MockUser()
    
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    
    try:
        # In production, verify with Firebase Admin SDK:
        # import firebase_admin
        # from firebase_admin import auth
        # decoded_token = auth.verify_id_token(credentials.credentials)
        # return MockUser(uid=decoded_token['uid'])
        
        # For now, just extract user ID from token (dev mode)
        return MockUser(uid=credentials.credentials[:20])
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication: {str(e)}",
        )


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> Optional[MockUser]:
    """Get current user if authenticated, otherwise None"""
    if not credentials:
        return None
    return await get_current_user(credentials)
