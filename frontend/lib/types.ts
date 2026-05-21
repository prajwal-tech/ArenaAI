export type JobStatus = "queued" | "running" | "completed" | "failed" | "timed_out" | "retrying";
export type RoomStatus = "waiting" | "active" | "scoring" | "finished";

export interface User {
  id: string;
  username: string;
}

export interface JobInfo {
  id: string;
  status: JobStatus;
  error_message?: string;
  retry_count?: number;
  updated_at?: string;
}

export interface Submission {
  id: string;
  participant_id: string;
  prompt: string;
  generated_output?: string;
  score?: number;
  score_reasoning?: string;
  submitted_at: string;
  job?: JobInfo;
}

export interface Round {
  id: string;
  round_number: number;
  status: string;
  started_at?: string;
  ended_at?: string;
  submissions: Submission[];
}

export interface Participant {
  id: string;
  user: User;
  score: number;
  eliminated: boolean;
}

export interface Room {
  id: string;
  code: string;
  host: User;
  challenge_prompt: string;
  status: RoomStatus;
  participants: Participant[];
  rounds: Round[];
  created_at: string;
}

export interface AuthState {
  token: string | null;
  user: { id: string; username: string } | null;
}
