"""Auth router: username/password login -> Bearer JWT, current user, change password."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from ..deps import CurrentUser, get_auth_service, get_current_user_allow_pending
from ...application import dto
from ...application.auth_service import AuthService
from ...core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"], responses=dto.ERROR_RESPONSES)

LOCAL_LOGIN_DISABLED_DETAIL = "local login disabled in gateway mode"


@router.post("/login", response_model=dto.LoginResponse)
def login(body: dto.LoginRequest, auth: AuthService = Depends(get_auth_service)):
    """Username is case-insensitive. 401 on bad credentials or an inactive account; 404 in
    gateway auth mode (identity comes from the gateway headers there)."""
    if settings.auth_mode == "gateway":
        raise HTTPException(status_code=404, detail=LOCAL_LOGIN_DISABLED_DETAIL)
    return auth.login(body)


@router.get("/me", response_model=dto.UserDTO)
def me(
    user: CurrentUser = Depends(get_current_user_allow_pending),
    auth: AuthService = Depends(get_auth_service),
):
    return auth.me(user)


@router.post("/change-password", status_code=204, response_class=Response)
def change_password(
    body: dto.ChangePasswordRequest,
    user: CurrentUser = Depends(get_current_user_allow_pending),
    auth: AuthService = Depends(get_auth_service),
) -> Response:
    """400 if ``current_password`` is wrong; clears ``must_change_password``. Revokes every
    token issued before this second (including the caller's): log in again afterwards."""
    auth.change_password(user, body)
    return Response(status_code=204)
