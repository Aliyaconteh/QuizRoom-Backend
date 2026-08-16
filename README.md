# KuizRoom Backend

Node.js, Express, Socket.IO, and Supabase backend for a real-time multiplayer quiz system.

## Requirements Covered

- User registration and login through Supabase Auth.
- Guest room joining with nickname validation.
- Quiz and question CRUD endpoints.
- Unique quiz room creation with room codes.
- Server-authoritative quiz flow with synchronized question timers.
- Answer validation, duplicate-submission prevention, scoring, and live leaderboard updates.
- Optimistic synchronization support with score reconciliation events.
- Network delay simulation using room delay settings.
- Synchronization metrics logging for latency, score mismatch, and reconciliation analysis.
- Session results and final leaderboard persistence.

## Setup

Create `Backend/.env` using this shape:

```env
PORT=5000
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

Run the SQL in `src/database/schema.sql` in Supabase before starting the API.

## Run

```bash
npm install
npm run dev
```

The API health check is available at:

```txt
GET /health
```

## Main REST Routes

- `POST /auth/signup`
- `POST /auth/login`
- `GET /api/quizzes`
- `POST /api/quizzes`
- `POST /api/quizzes/question`
- `POST /api/rooms/create`
- `POST /api/rooms/join`
- `GET /api/rooms/:roomCode`
- `GET /api/leaderboard/:roomCode`
- `GET /api/leaderboard/:roomCode/final`
- `GET /api/sync/:roomCode/logs`
- `GET /api/sync/:roomCode/summary`

## Main Socket.IO Events

Client to server:

- `create-room`
- `join-room`
- `start-quiz`
- `submit-answer`
- `next-question`
- `optimistic-answer`
- `confirm-answer`
- `sync-reconcile`

Server to client:

- `room-created`
- `player-joined`
- `question-started`
- `timer-update`
- `leaderboard-update`
- `server-confirmation`
- `sync-reconciliation`
- `quiz-ended`
