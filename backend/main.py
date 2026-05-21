import asyncio
import json
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from auth import create_access_token, hash_password, verify_password, get_current_user
from database import get_db, init_db
from job_worker import process_job
from models import (
    GenerationJob, JobStatus, Participant, Room, RoomEvent, RoomStatus,
    Round, Submission, User,
)
from schemas import (
    CreateRoomRequest, EliminateParticipantRequest, JoinRoomRequest,
    LoginRequest, RegisterRequest, ScoreSubmissionRequest,
    SubmitPromptRequest, TokenResponse,
)
from serializers import get_full_room, serialize_room, serialize_round
from ws_manager import manager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="ArenaAI Battle Room API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Auth ────────────────────────────────────────────────────────────────────

@app.post("/auth/register", response_model=TokenResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == req.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    username_check = await db.execute(select(User).where(User.username == req.username))
    if username_check.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already taken")

    user = User(
        id=str(uuid.uuid4()),
        username=req.username,
        email=req.email,
        hashed_password=hash_password(req.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token({"sub": user.id})
    return TokenResponse(access_token=token, user_id=user.id, username=user.username)


@app.post("/auth/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token({"sub": user.id})
    return TokenResponse(access_token=token, user_id=user.id, username=user.username)


@app.get("/auth/me")
async def me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "username": current_user.username, "email": current_user.email}


# ─── Rooms ───────────────────────────────────────────────────────────────────

@app.post("/rooms")
async def create_room(
    req: CreateRoomRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    room = Room(
        id=str(uuid.uuid4()),
        host_id=current_user.id,
        challenge_prompt=req.challenge_prompt,
        status=RoomStatus.waiting,
    )
    db.add(room)
    await db.commit()
    await db.refresh(room)

    data = await get_full_room(db, room.id)
    return data


@app.get("/rooms/code/{code}")
async def get_room_by_code(
    code: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Room).where(Room.code == code.upper()))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    data = await get_full_room(db, room.id)
    return data


@app.get("/rooms/{room_id}")
async def get_room(
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = await get_full_room(db, room_id)
    if not data:
        raise HTTPException(status_code=404, detail="Room not found")
    return data


@app.post("/rooms/{room_id}/join")
async def join_room(
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Room)
        .options(selectinload(Room.participants))
        .where(Room.id == room_id)
    )
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.host_id == current_user.id:
        raise HTTPException(status_code=400, detail="Host cannot join as participant")
    if room.status == RoomStatus.finished:
        raise HTTPException(status_code=400, detail="Room is finished")

    existing = await db.execute(
        select(Participant).where(
            Participant.room_id == room_id,
            Participant.user_id == current_user.id,
        )
    )
    if existing.scalar_one_or_none():
        data = await get_full_room(db, room_id)
        return data

    participant = Participant(
        id=str(uuid.uuid4()),
        room_id=room_id,
        user_id=current_user.id,
    )
    db.add(participant)
    await db.commit()

    data = await get_full_room(db, room_id)
    await manager.broadcast(room_id, "participant_joined", {
        "participant": {"id": participant.id, "user": {"id": current_user.id, "username": current_user.username}, "score": 0, "eliminated": False}
    })
    return data


# ─── Round Lifecycle (Host Only) ─────────────────────────────────────────────

@app.post("/rooms/{room_id}/start-round")
async def start_round(
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Room).options(selectinload(Room.rounds)).where(Room.id == room_id)
    )
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.host_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only host can start rounds")
    if room.status == RoomStatus.finished:
        raise HTTPException(status_code=400, detail="Room is finished")

    # Close any active round first
    for r in room.rounds:
        if r.status == "active":
            r.status = "completed"
            r.ended_at = datetime.utcnow()

    round_number = len(room.rounds) + 1
    new_round = Round(
        id=str(uuid.uuid4()),
        room_id=room_id,
        round_number=round_number,
        status="active",
        started_at=datetime.utcnow(),
    )
    db.add(new_round)
    room.status = RoomStatus.active
    await db.commit()

    await manager.broadcast(room_id, "round_started", {
        "round": {
            "id": new_round.id,
            "round_number": round_number,
            "status": "active",
            "started_at": new_round.started_at.isoformat(),
            "submissions": [],
        }
    })
    data = await get_full_room(db, room_id)
    return data


@app.post("/rooms/{room_id}/end-round")
async def end_round(
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Room).options(selectinload(Room.rounds)).where(Room.id == room_id)
    )
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.host_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only host can end rounds")

    active_round = next((r for r in room.rounds if r.status == "active"), None)
    if not active_round:
        raise HTTPException(status_code=400, detail="No active round")

    active_round.status = "scoring"
    active_round.ended_at = datetime.utcnow()
    room.status = RoomStatus.scoring
    await db.commit()

    await manager.broadcast(room_id, "round_ended", {
        "round_id": active_round.id,
        "status": "scoring",
    })
    data = await get_full_room(db, room_id)
    return data


@app.post("/rooms/{room_id}/finish")
async def finish_room(
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.host_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only host can finish the room")

    room.status = RoomStatus.finished
    await db.commit()

    await manager.broadcast(room_id, "room_finished", {"room_id": room_id})
    return {"status": "finished"}


# ─── Submissions (Participants Only) ─────────────────────────────────────────

@app.post("/rooms/{room_id}/submit")
async def submit_prompt(
    room_id: str,
    req: SubmitPromptRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Verify room
    result = await db.execute(
        select(Room)
        .options(selectinload(Room.rounds).selectinload(Round.submissions))
        .where(Room.id == room_id)
    )
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.host_id == current_user.id:
        raise HTTPException(status_code=403, detail="Host cannot submit as contestant")
    if room.status != RoomStatus.active:
        raise HTTPException(status_code=400, detail="No active round")

    # Verify participant
    part_result = await db.execute(
        select(Participant).where(
            Participant.room_id == room_id,
            Participant.user_id == current_user.id,
        )
    )
    participant = part_result.scalar_one_or_none()
    if not participant:
        raise HTTPException(status_code=403, detail="You must join the room first")
    if participant.eliminated:
        raise HTTPException(status_code=403, detail="You have been eliminated")

    # Find active round
    active_round = next((r for r in room.rounds if r.status == "active"), None)
    if not active_round:
        raise HTTPException(status_code=400, detail="No active round")

    # Check if already submitted this round
    existing_sub = await db.execute(
        select(Submission).where(
            Submission.round_id == active_round.id,
            Submission.participant_id == participant.id,
        )
    )
    if existing_sub.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Already submitted for this round")

    # Validate prompt
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")
    if len(req.prompt) > 1000:
        raise HTTPException(status_code=400, detail="Prompt too long (max 1000 chars)")

    # Create submission + job
    submission = Submission(
        id=str(uuid.uuid4()),
        round_id=active_round.id,
        participant_id=participant.id,
        prompt=req.prompt.strip(),
    )
    db.add(submission)
    await db.flush()

    job = GenerationJob(
        id=str(uuid.uuid4()),
        submission_id=submission.id,
        status=JobStatus.queued,
    )
    db.add(job)
    await db.commit()

    # Broadcast submission created
    await manager.broadcast(room_id, "submission_created", {
        "submission": {
            "id": submission.id,
            "participant_id": participant.id,
            "participant_username": current_user.username,
            "prompt": submission.prompt,
            "generated_output": None,
            "score": None,
            "job": {"id": job.id, "status": "queued"},
        }
    })

    # Kick off async job (non-blocking)
    asyncio.create_task(process_job(job.id))

    return {
        "submission_id": submission.id,
        "job_id": job.id,
        "status": "queued",
    }


# ─── Scoring (Host Only) ─────────────────────────────────────────────────────

@app.post("/rooms/{room_id}/score")
async def score_submission(
    room_id: str,
    req: ScoreSubmissionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.host_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only host can score")
    if req.score < 0 or req.score > 10:
        raise HTTPException(status_code=400, detail="Score must be between 0 and 10")

    sub_result = await db.execute(
        select(Submission)
        .options(selectinload(Submission.participant))
        .where(Submission.id == req.submission_id)
    )
    submission = sub_result.scalar_one_or_none()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    submission.score = req.score
    submission.score_reasoning = req.reasoning

    # Update participant total score
    submission.participant.score = (submission.participant.score or 0) + req.score
    await db.commit()

    await manager.broadcast(room_id, "submission_scored", {
        "submission_id": req.submission_id,
        "score": req.score,
        "reasoning": req.reasoning,
        "participant_id": submission.participant_id,
        "participant_total_score": submission.participant.score,
    })
    return {"ok": True}


@app.post("/rooms/{room_id}/eliminate")
async def eliminate_participant(
    room_id: str,
    req: EliminateParticipantRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.host_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only host can eliminate participants")

    part_result = await db.execute(
        select(Participant)
        .options(selectinload(Participant.user))
        .where(Participant.id == req.participant_id)
    )
    participant = part_result.scalar_one_or_none()
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    participant.eliminated = True
    await db.commit()

    await manager.broadcast(room_id, "participant_eliminated", {
        "participant_id": req.participant_id,
        "username": participant.user.username,
    })
    return {"ok": True}


# ─── WebSocket ───────────────────────────────────────────────────────────────

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await manager.connect(websocket, room_id)
    try:
        while True:
            # Keep connection alive; client can send pings
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await manager.send_personal(websocket, "pong", {})
            except Exception:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)
    except Exception:
        manager.disconnect(websocket, room_id)


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}
