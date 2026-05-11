# CLAUDE.md — Online Programming Contest Management System

## Project Identity
This is an **Online Programming Contest Management System** (OCMS) — a VJudge-inspired
web platform built for CS 2005 (Database Systems). Users register, create contests, add
problems, submit code, and track performance via leaderboards and personal stats.

**Stack:** Node.js + Express · PostgreSQL · Plain HTML/CSS/JS (no frontend framework)
**Course:** CS 2005 – Database Systems · May 2026

---

## Project Structure

```
contest-system/
├── server.js                  # Entry point — Express app, routes, middleware setup
├── .env                       # DB credentials, session secret, port (never commit)
├── .env.example               # Safe template for .env
├── package.json
├── db/
│   ├── pool.js                # PostgreSQL connection pool (pg)
│   ├── schema.sql             # ALL tables, indexes, views, triggers, stored procedures
│   └── seed.sql               # Sample users, contests, problems, submissions
├── routes/
│   ├── auth.js                # /api/auth/*
│   ├── users.js               # /api/users/*
│   ├── profile.js             # /api/profile/*
│   ├── contests.js            # /api/contests/*
│   └── problems.js            # /api/contests/:id/problems/*
├── controllers/
│   ├── authController.js
│   ├── userController.js
│   ├── profileController.js
│   ├── contestController.js
│   └── problemController.js
├── middleware/
│   └── auth.js                # requireAuth, setLastSeen
├── services/
│   └── judge.js               # OneCompiler API integration + judging logic
└── public/                    # All frontend files served statically
    ├── index.html             # Home / profile dashboard
    ├── login.html
    ├── register.html
    ├── users.html
    ├── profile.html           # Public user profile (?username=)
    ├── contests.html
    ├── create-contest.html
    ├── contest.html           # Contest view (?id=)
    ├── problem.html           # Problem solving page (?contestId=&problemId=)
    ├── leaderboard.html       # ICPC leaderboard (?id=)
    ├── manager.html           # Contest manager panel (?id=)
    ├── css/
    │   └── style.css
    └── js/
        └── api.js             # Shared fetch wrapper — handles 401 → redirect to /login
```

---

## Database Schema (9 Tables)

```sql
users               -- id, full_name, username(UNIQUE), email(UNIQUE), password_hash,
                    -- last_seen, is_online, current_streak, longest_streak, created_at

contests            -- id, name(UNIQUE), description, password_hash, start_time,
                    -- duration_minutes, created_by(FK→users), is_ended, created_at

contest_participants -- contest_id(FK), user_id(FK), joined_at | PK(contest_id, user_id)

problems            -- id, title, type('custom'|'external'), platform, source_url,
                    -- statement, input_format, output_format, constraints_text,
                    -- time_limit_ms, memory_limit_mb, hints, model_solution,
                    -- created_by(FK→users), created_at

contest_problems    -- contest_id(FK), problem_id(FK), label CHAR(1) | PK(contest_id, problem_id)

test_cases          -- id, problem_id(FK), input, expected_output, is_hidden

submissions         -- id, user_id(FK), contest_id(FK), problem_id(FK), language, code,
                    -- verdict CHECK(...), execution_time_ms, submitted_at

user_daily_activity -- user_id(FK), activity_date DATE | PK(user_id, activity_date)

contest_scores      -- contest_id(FK), user_id(FK), solved INT, penalty INT
                    -- PK(contest_id, user_id)
```

### Required DB Objects (course requirement — must all exist)

| Object | Name | Purpose |
|--------|------|---------|
| VIEW | `leaderboard_view` | ICPC rank, solved count, penalty per user per contest |
| VIEW | `user_stats_view` | Aggregated user stats (solved, attempted, streaks) |
| TRIGGER | on `submissions` INSERT | Updates `user_daily_activity` + recalculates streak |
| STORED PROC | `submit_and_score()` | Atomic: insert submission + update contest_scores |
| STORED PROC | `get_user_profile()` | Returns full profile stats in one call |
| INDEXES | multiple | submissions(user_id), submissions(contest_id, problem_id), etc. |

---

## API Routes Reference

### Auth — `/api/auth`
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/register` | Register new user |
| POST | `/login` | Login with username or email |
| POST | `/logout` | Destroy session |
| GET | `/me` | Get current session user or 401 |

### Users — `/api/users`
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | All users, sorted. Accepts `?search=` |
| GET | `/:username` | Public profile |

### Profile — `/api/profile`
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/me` | Full profile for logged-in user |

### Contests — `/api/contests`
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | All running + upcoming contests |
| POST | `/` | Create contest |
| GET | `/:id` | Contest detail |
| POST | `/:id/join` | Join a contest |
| GET | `/:id/leaderboard` | ICPC leaderboard |
| GET | `/:id/manager/submissions` | All submissions (manager only) |
| GET | `/:id/manager/stats` | Per-problem stats (manager only) |
| PATCH | `/:id` | Edit contest (manager only) |
| POST | `/:id/end` | End contest early (manager only) |

### Problems — `/api/contests/:id/problems`
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | List problems with user status |
| POST | `/` | Add problem (manager only) |
| DELETE | `/:problemId` | Remove problem (manager, before start only) |
| GET | `/:problemId` | Full problem detail |
| POST | `/:problemId/submit` | Submit code |
| GET | `/:problemId/submissions` | User's submission history |
| POST | `/:problemId/testcases/bulk` | Bulk CSV upload (manager only) |

### Submissions — `/api/submissions`
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/:id` | Single submission detail |
| GET | `/:id/status` | Verdict only (for polling) |

---

## Key Business Logic

### ICPC Scoring
- +1 point per problem solved
- Penalty = minutes from contest start to first AC
- +20 minutes per wrong attempt before AC (only on eventually solved problems)
- Wrong attempts on unsolved problems add zero penalty
- Rank: solved DESC → penalty ASC → username ASC

### Judging Pipeline
1. Submission inserted as `Pending` immediately (user gets instant feedback)
2. Background async: judge runs via OneCompiler API (custom) or stored as Pending (external)
3. `submit_and_score()` stored procedure called with final verdict — atomic transaction
4. Frontend polls `GET /api/submissions/:id/status` every 2 seconds until resolved

### Streak Calculation
- Trigger fires on every `INSERT` into `submissions` where `verdict = 'Accepted'`
- Inserts into `user_daily_activity(user_id, today)` — ON CONFLICT DO NOTHING
- Recalculates consecutive days ending today → updates `current_streak`
- Updates `longest_streak` if `current_streak` exceeds it

### Online Status
- `setLastSeen` middleware updates `last_seen` + `is_online=true` on every auth'd request
- `setInterval` every 2 min sets `is_online=false` for users inactive > 3 minutes

---

## Environment Variables

```env
DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/contest_db
SESSION_SECRET=a_long_random_secret_string_here
PORT=3000
ONECOMPILER_API_KEY=your_onecompiler_api_key_here
```

---

## External APIs

### OneCompiler API
- **Endpoint:** `POST https://onecompiler.com/api/v1/run`
- **Auth:** `X-API-Key` header
- **Body:** `{ language, stdin, files: [{ name, content }] }`
- **Response:** `{ status, stdout, stderr, executionTime }`
- **Language map:** C++17 → `cpp`, Python 3 → `python`, Java → `java`, C → `c`
- Run up to 3 test cases in parallel via `Promise.all`

### External Platforms (CSES / CodeChef / HackerRank / USACO)
- Only problem metadata (title, URL, platform) is stored locally
- Submissions are forwarded to the platform; verdict stored as received
- No live sync with external platforms

---

## Frontend Conventions

- All API calls use the shared `public/js/api.js` fetch wrapper
- 401 responses automatically redirect to `/login.html`
- No jQuery, no axios — native `fetch()` only
- CodeMirror 5 loaded from CDN for the code editor on `problem.html`
- All error messages shown inline in the UI — never `alert()`
- Verdict badge colors: Accepted=green, WA=red, TLE=orange, RE=purple, CE=gray, Pending=gray
- Timestamps displayed as relative time ("3 minutes ago")

---

## Development Rules (for Claude Code)

1. **All SQL queries must use parameterized placeholders** (`$1, $2`) — never string interpolation
2. **Never return `password_hash`** in any API response under any circumstances
3. **Manager-only endpoints** must check `req.session.userId === contest.created_by` → 403 otherwise
4. **Every route must have try/catch** returning `{ error: message }` with correct HTTP status
5. **Submission judging is always async** — never block the HTTP response waiting for verdict
6. **Hidden test cases are never returned** to non-manager users under any circumstances
7. **Contest passwords are stored hashed** — never return them in any API response
8. **Label assignment** for contest problems: first = A, second = B, etc. — fixed once contest starts
9. **Only first AC counts** for scoring — subsequent accepted submissions don't change score
10. **Ended contests** must not appear on the contests list page

---

## Common Commands

```bash
# Start the server
node server.js

# Health check
curl http://localhost:3000/api/health
# Expected: { "status": "ok", "db": "connected" }

# Load schema (run in pgAdmin Query Tool)
# Open db/schema.sql → F5

# Load seed data (run in pgAdmin Query Tool)
# Open db/seed.sql → F5
```

---

## HTTP Status Code Conventions

| Code | When to use |
|------|-------------|
| 200 | Success |
| 201 | Resource created |
| 400 | Validation error (missing fields, bad input) |
| 401 | Not authenticated (no session) |
| 403 | Authenticated but not authorized (not manager, etc.) |
| 404 | Resource not found |
| 409 | Conflict (duplicate username, contest name already exists) |
| 500 | Unexpected server/DB error |
