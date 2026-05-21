from sqlalchemy import Column, String, Integer, Float, DateTime, Text, ForeignKey, Boolean, Enum as SAEnum
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.sql import func
import enum
import uuid


def gen_id():
    return str(uuid.uuid4())[:8].upper()


class Base(DeclarativeBase):
    pass


class JobStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    timed_out = "timed_out"


class RoomStatus(str, enum.Enum):
    waiting = "waiting"
    active = "active"
    scoring = "scoring"
    finished = "finished"


class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String, unique=True, nullable=False)
    email = Column(String, unique=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    rooms_hosted = relationship("Room", back_populates="host", foreign_keys="Room.host_id")
    participations = relationship("Participant", back_populates="user")


class Room(Base):
    __tablename__ = "rooms"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    code = Column(String, unique=True, nullable=False, default=gen_id)
    host_id = Column(String, ForeignKey("users.id"), nullable=False)
    challenge_prompt = Column(Text, nullable=False)
    status = Column(SAEnum(RoomStatus), default=RoomStatus.waiting, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    host = relationship("User", back_populates="rooms_hosted", foreign_keys=[host_id])
    participants = relationship("Participant", back_populates="room")
    rounds = relationship("Round", back_populates="room", order_by="Round.round_number")


class Participant(Base):
    __tablename__ = "participants"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id = Column(String, ForeignKey("rooms.id"), nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    score = Column(Float, default=0.0)
    eliminated = Column(Boolean, default=False)
    joined_at = Column(DateTime, server_default=func.now())

    room = relationship("Room", back_populates="participants")
    user = relationship("User", back_populates="participations")
    submissions = relationship("Submission", back_populates="participant")


class Round(Base):
    __tablename__ = "rounds"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id = Column(String, ForeignKey("rooms.id"), nullable=False)
    round_number = Column(Integer, nullable=False)
    status = Column(String, default="pending")  # pending, active, scoring, completed
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)

    room = relationship("Room", back_populates="rounds")
    submissions = relationship("Submission", back_populates="round")


class Submission(Base):
    __tablename__ = "submissions"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    round_id = Column(String, ForeignKey("rounds.id"), nullable=False)
    participant_id = Column(String, ForeignKey("participants.id"), nullable=False)
    prompt = Column(Text, nullable=False)
    generated_output = Column(Text, nullable=True)
    score = Column(Float, nullable=True)
    score_reasoning = Column(Text, nullable=True)
    submitted_at = Column(DateTime, server_default=func.now())

    round = relationship("Round", back_populates="submissions")
    participant = relationship("Participant", back_populates="submissions")
    job = relationship("GenerationJob", back_populates="submission", uselist=False)


class GenerationJob(Base):
    __tablename__ = "generation_jobs"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    submission_id = Column(String, ForeignKey("submissions.id"), nullable=False)
    status = Column(SAEnum(JobStatus), default=JobStatus.queued, nullable=False)
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    submission = relationship("Submission", back_populates="job")


class RoomEvent(Base):
    __tablename__ = "room_events"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id = Column(String, ForeignKey("rooms.id"), nullable=False)
    event_type = Column(String, nullable=False)
    payload = Column(Text, nullable=True)  # JSON string
    created_at = Column(DateTime, server_default=func.now())
