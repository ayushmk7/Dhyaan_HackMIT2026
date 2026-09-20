from datetime import date as _date

from fastapi import APIRouter
from pydantic import BaseModel, field_validator

from .. import baseline, rag

router = APIRouter(prefix="/v1", tags=["chat"])


class ChatRequest(BaseModel):
    question: str


class ChatResponse(BaseModel):
    answer: str
    # [{id, kind: "observed"|"told"|"pattern", ts, text}] — the kind is the
    # point: a family must always be able to tell what Dhyaan saw from what
    # they told us and from what is merely her pattern (VLM_PLAN §6.5).
    citations: list[dict]
    retrieved_count: int
    refused: bool = False
    refusal_kind: str | None = None


class RollupRequest(BaseModel):
    resident_id: str
    date: str  # local date, "YYYY-MM-DD"

    @field_validator("date")
    @classmethod
    def _padded_iso(cls, v: str) -> str:
        # "2026-9-1" used to reach baseline._day_range_utc and 500 out of a
        # button the timeline screen presses. A malformed date is the caller's
        # mistake, so say 422 rather than dying of it.
        _date.fromisoformat(v)
        return v


@router.post("/residents/{resident_id}/chat", response_model=ChatResponse)
async def chat(resident_id: str, body: ChatRequest):
    """The family's "how has mum been this week" screen."""
    # answer_family(), not answer(): the guard, the kind labels and the
    # family filter all live on the extended path.
    return await rag.answer_family(resident_id, body.question)


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
