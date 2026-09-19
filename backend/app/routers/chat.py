from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import baseline, rag
from ..deps import require_app_key

router = APIRouter(prefix="/v1", tags=["chat"], dependencies=[Depends(require_app_key)])


class ChatRequest(BaseModel):
    question: str


class ChatResponse(BaseModel):
    answer: str
    citations: list[dict]
    retrieved_count: int


class RollupRequest(BaseModel):
    resident_id: str
    date: str  # local date, "YYYY-MM-DD"


@router.post("/residents/{resident_id}/chat", response_model=ChatResponse)
async def chat(resident_id: str, body: ChatRequest):
    """The family's "how has mum been this week" screen."""
    return await rag.answer(resident_id, body.question)


@router.post("/admin/rollup")
async def admin_rollup(body: RollupRequest):
    """Manual trigger for the nightly baseline rollup + daily narrative — the
    demo can't wait for 03:30 local."""
    rollup_result = await baseline.rollup(body.resident_id, body.date)
    narrative = await rag.daily_narrative(body.resident_id, body.date)
    return {
        "resident_id": body.resident_id,
        "date": body.date,
        "features": {k: v["value"] for k, v in rollup_result.items()},
        "deviations": {k: v["result"] for k, v in rollup_result.items() if v["result"]},
        "narrative": narrative,
    }
