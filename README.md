# ArenaAI — Real-time AI Creative Battle Room

A multiplayer platform where participants compete in AI-powered creative challenges. Built with a local LLM via Ollama no API keys, no cloud costs.

## What is it?

A host creates a room with a creative challenge. Participants join using a room code, submit their concept, and a local AI generates a full creative output for each entry in real time. The host scores, ranks, and eliminates participants. Everything updates live no refresh needed.

---

## Tech Stack

**Backend**
- FastAPI (Python)
- SQLAlchemy + SQLite
- WebSockets for real-time updates
- Async job queue (queued → running → completed → failed)

**Frontend**
- Next.js + TypeScript
- Tailwind CSS
- Zustand for state management
- Axios

**AI**
- Ollama (runs locally — no API key needed)
- Supports any Ollama model: llama3.2, qwen2.5, gemma3, deepseek-r1

---

## How to Run

### Prerequisites
- Python 3.11+
- Node.js 18+
- Ollama installed and running locally

### 1. Pull a model in Ollama

ollama pull llama3.2:1b
```

### 2. Backend

cd backend
cp .env.example .env
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 3. Frontend
```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Open **http://localhost:3000**

---

## How to Play

1. Register an account and create a room with a challenge prompt
2. Share the room code with friends
3. Friends join from a separate browser or incognito tab
4. Host starts a round
5. Participants submit their creative concept
6. AI generates a full output for each submission in real time
7. Host scores each submission (0–10) and can eliminate participants
8. Start the next round or finish the battle

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description |
|---|---|
| `SECRET_KEY` | JWT signing key — change this in production |
| `DATABASE_URL` | SQLite file path |
| `OLLAMA_URL` | Ollama server URL (default: http://localhost:11434) |
| `OLLAMA_MODEL` | Model to use (default: llama3.2:1b) |

### Frontend (`frontend/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend URL (default: http://localhost:8000) |

---

## Features

- Real-time room updates via WebSockets
- Async AI generation with retry and timeout handling
- Backend-enforced roles (host vs participant)
- Full state persistence — refresh never loses progress
- Leaderboard with live scoring
- Participant elimination
- Works with any Ollama model
- Falls back to mock output if Ollama is unavailable

---

## Project Structure

arenaai/
├── backend/
│   ├── main.py            # All API routes
│   ├── models.py          # Database models
│   ├── job_worker.py      # Async AI generation jobs
│   ├── ai_provider.py     # Ollama / Anthropic / Mock abstraction
│   ├── ws_manager.py      # WebSocket connection manager
│   ├── auth.py            # JWT authentication
│   └── database.py        # DB connection
└── frontend/
    ├── app/
    │   ├── page.tsx            # Login + Lobby
    │   └── room/[id]/page.tsx  # Battle room UI
    └── lib/
        ├── store.ts            # Zustand auth store
        ├── useWebSocket.ts     # WS hook with auto-reconnect
        └── types.ts            # TypeScript types
```


## Known Limitations

- Generation jobs are lost if the server restarts mid-generation (no persistent queue)
- SQLite is fine for local use — swap to PostgreSQL for production
- No spectator mode yet



## Built With

Built using FastAPI, Next.js, and Ollama. 



MIT
