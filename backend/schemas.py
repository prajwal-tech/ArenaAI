from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime
from models import JobStatus, RoomStatus


# Auth
class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str


# Room
class CreateRoomRequest(BaseModel):
    challenge_prompt: str


class JoinRoomRequest(BaseModel):
    code: str


class UserInfo(BaseModel):
    id: str
    username: str


class ParticipantInfo(BaseModel):
    id: str
    user: UserInfo
    score: float
    eliminated: bool


class JobInfo(BaseModel):
    id: str
    status: JobStatus
    error_message: Optional[str] = None
    updated_at: Optional[datetime] = None


class SubmissionInfo(BaseModel):
    id: str
    participant_id: str
    prompt: str
    generated_output: Optional[str] = None
    score: Optional[float] = None
    score_reasoning: Optional[str] = None
    submitted_at: datetime
    job: Optional[JobInfo] = None


class RoundInfo(BaseModel):
    id: str
    round_number: int
    status: str
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    submissions: List[SubmissionInfo] = []


class RoomDetail(BaseModel):
    id: str
    code: str
    host: UserInfo
    challenge_prompt: str
    status: RoomStatus
    participants: List[ParticipantInfo] = []
    rounds: List[RoundInfo] = []
    created_at: datetime


# Submission
class SubmitPromptRequest(BaseModel):
    prompt: str


# Scoring
class ScoreSubmissionRequest(BaseModel):
    submission_id: str
    score: float
    reasoning: Optional[str] = None


class EliminateParticipantRequest(BaseModel):
    participant_id: str
