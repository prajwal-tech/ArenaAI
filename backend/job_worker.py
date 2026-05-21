import asyncio
import json
import logging
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from database import AsyncSessionLocal
from models import GenerationJob, Submission, Round, Room, JobStatus
from ai_provider import ai_provider
from ws_manager import manager

logger = logging.getLogger(__name__)

MAX_RETRIES = 2
JOB_TIMEOUT = 30  # seconds


async def process_job(job_id: str):
    """
    Runs in background. Manages the full job lifecycle:
    queued -> running -> completed/failed/timed_out
    """
    logger.info(f"Processing job {job_id}")

    for attempt in range(MAX_RETRIES + 1):
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(GenerationJob)
                .options(
                    selectinload(GenerationJob.submission)
                    .selectinload(Submission.round)
                    .selectinload(Round.room)
                )
                .where(GenerationJob.id == job_id)
            )
            job = result.scalar_one_or_none()
            if not job:
                logger.error(f"Job {job_id} not found")
                return

            submission = job.submission
            room = submission.round.room
            room_id = room.id
            challenge_prompt = room.challenge_prompt
            user_prompt = submission.prompt

            # Set to running
            job.status = JobStatus.running
            job.retry_count = attempt
            await db.commit()

        await manager.broadcast(room_id, "job_update", {
            "job_id": job_id,
            "submission_id": submission.id,
            "status": "running",
            "retry_count": attempt,
        })

        # Run generation with timeout
        try:
            generated = await asyncio.wait_for(
                ai_provider.generate(challenge_prompt, user_prompt),
                timeout=JOB_TIMEOUT
            )

            # Save completed result
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(GenerationJob).where(GenerationJob.id == job_id)
                )
                job = result.scalar_one()
                job.status = JobStatus.completed
                await db.commit()

                sub_result = await db.execute(
                    select(Submission).where(Submission.id == submission.id)
                )
                sub = sub_result.scalar_one()
                sub.generated_output = generated
                await db.commit()

            await manager.broadcast(room_id, "job_update", {
                "job_id": job_id,
                "submission_id": submission.id,
                "status": "completed",
                "generated_output": generated,
            })
            logger.info(f"Job {job_id} completed on attempt {attempt}")
            return

        except asyncio.TimeoutError:
            logger.warning(f"Job {job_id} timed out on attempt {attempt}")
            if attempt < MAX_RETRIES:
                await manager.broadcast(room_id, "job_update", {
                    "job_id": job_id,
                    "submission_id": submission.id,
                    "status": "retrying",
                    "retry_count": attempt + 1,
                })
                await asyncio.sleep(2)
                continue

            async with AsyncSessionLocal() as db:
                result = await db.execute(select(GenerationJob).where(GenerationJob.id == job_id))
                job = result.scalar_one()
                job.status = JobStatus.timed_out
                job.error_message = "Generation timed out after multiple attempts"
                await db.commit()

            await manager.broadcast(room_id, "job_update", {
                "job_id": job_id,
                "submission_id": submission.id,
                "status": "timed_out",
                "error": "Generation timed out",
            })
            return

        except Exception as e:
            logger.error(f"Job {job_id} failed on attempt {attempt}: {e}")
            if attempt < MAX_RETRIES:
                await manager.broadcast(room_id, "job_update", {
                    "job_id": job_id,
                    "submission_id": submission.id,
                    "status": "retrying",
                    "retry_count": attempt + 1,
                    "error": str(e),
                })
                await asyncio.sleep(2 ** attempt)  # exponential backoff
                continue

            async with AsyncSessionLocal() as db:
                result = await db.execute(select(GenerationJob).where(GenerationJob.id == job_id))
                job = result.scalar_one()
                job.status = JobStatus.failed
                job.error_message = str(e)
                await db.commit()

            await manager.broadcast(room_id, "job_update", {
                "job_id": job_id,
                "submission_id": submission.id,
                "status": "failed",
                "error": str(e),
            })
            return
