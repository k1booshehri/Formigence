from __future__ import annotations

from fastapi import APIRouter

from app.api import auth, me, public, questionnaires, responses

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(me.router)
api_router.include_router(questionnaires.router)
api_router.include_router(responses.router)
api_router.include_router(public.router)
