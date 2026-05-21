from models import Room, Participant, Round, Submission, GenerationJob
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload


async def get_full_room(db: AsyncSession, room_id: str) -> dict | None:
    result = await db.execute(
        select(Room)
        .options(
            selectinload(Room.host),
            selectinload(Room.participants).selectinload(Participant.user),
            selectinload(Room.rounds).selectinload(Round.submissions).selectinload(Submission.job),
        )
        .where(Room.id == room_id)
    )
    room = result.scalar_one_or_none()
    if not room:
        return None
    return serialize_room(room)


def serialize_room(room: Room) -> dict:
    return {
        "id": room.id,
        "code": room.code,
        "host": {"id": room.host.id, "username": room.host.username},
        "challenge_prompt": room.challenge_prompt,
        "status": room.status.value,
        "participants": [serialize_participant(p) for p in room.participants],
        "rounds": [serialize_round(r) for r in sorted(room.rounds, key=lambda x: x.round_number)],
        "created_at": room.created_at.isoformat() if room.created_at else None,
    }


def serialize_participant(p: Participant) -> dict:
    return {
        "id": p.id,
        "user": {"id": p.user.id, "username": p.user.username},
        "score": p.score,
        "eliminated": p.eliminated,
    }


def serialize_round(r: Round) -> dict:
    return {
        "id": r.id,
        "round_number": r.round_number,
        "status": r.status,
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "ended_at": r.ended_at.isoformat() if r.ended_at else None,
        "submissions": [serialize_submission(s) for s in r.submissions],
    }


def serialize_submission(s: Submission) -> dict:
    return {
        "id": s.id,
        "participant_id": s.participant_id,
        "prompt": s.prompt,
        "generated_output": s.generated_output,
        "score": s.score,
        "score_reasoning": s.score_reasoning,
        "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
        "job": serialize_job(s.job) if s.job else None,
    }


def serialize_job(j: GenerationJob) -> dict:
    return {
        "id": j.id,
        "status": j.status.value,
        "error_message": j.error_message,
        "retry_count": j.retry_count,
        "updated_at": j.updated_at.isoformat() if j.updated_at else None,
    }
