# Online Contest Management System (OCMS)

A full-stack programming contest platform built for **CS 2005 – Database Systems** (May 2026).

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express.js |
| Database | PostgreSQL 14+ |
| Frontend | Plain HTML / CSS / JavaScript (no framework) |
| Auth | express-session + bcrypt |
| DB Driver | node-postgres (pg) |
| Code Editor | CodeMirror 5 (CDN) |
| Judge API | OneCompiler API |

---

## Features

- **Authentication** — Register and login with username or email. Passwords hashed with bcrypt.
- **Contest Management** — Create public or password-protected contests with start time and duration.
- **Custom Problems** — Full problem authoring: statement, input/output format, constraints, hints, sample and hidden test cases.
- **Real-time Judging** — Submissions judged via OneCompiler API. Async pipeline with live verdict polling.
- **ICPC Leaderboard** — Live leaderboard with penalty scoring. Refreshes every 30 seconds during active contests.
- **Streak Tracking** — Daily streaks auto-calculated via PostgreSQL trigger on every Accepted submission.
- **User Profiles** — Public profiles with stats, streaks, contest history, and recent accepted submissions.
- **Manager Panel** — View all submissions and code, per-problem stats, edit contest, end early.
- **Bulk Test Cases** — Upload hidden test cases via CSV for any custom problem.
- **User Search** — Real-time search and filter on the users page, sorted by problems solved.

---

## Judging Pipeline

```
User submits code
       │
       ▼
INSERT submission (verdict = 'Pending')   ← HTTP response returned here
       │
       ▼  (async, background)
Fetch hidden test cases from DB
       │
       ▼
For each test case:
  POST to OneCompiler API
  Compare stdout vs expected_output (trimmed)
       │
       ├─ mismatch           → Wrong Answer
       ├─ exec > time_limit  → Time Limit Exceeded
       ├─ stderr present     → Runtime Error
       └─ all pass           → Accepted
       │
       ▼
CALL submit_and_score()   ← atomic transaction
  INSERT submission with final verdict
  UPDATE contest_scores (if first AC on this problem)
       │
       ▼
Frontend polls /api/submissions/:id/status every 2 s
until verdict is resolved
```

**Languages supported:** C++17, Python 3, Java, C, JavaScript, Kotlin

---

## ICPC Scoring

Rank is determined by most problems solved, then least penalty time.

```
penalty = Σ (AC_time_in_minutes + 20 × wrong_attempts_before_AC)
          for each problem that was eventually solved
```

Wrong attempts on **unsolved** problems add zero penalty.

**Tiebreaker:** solved DESC → penalty ASC → username ASC

---

## How to Run

### Prerequisites

- Node.js v18+
- PostgreSQL 14+
- pgAdmin (recommended for schema loading on Windows)
- A free [OneCompiler API key](https://onecompiler.com)

### Setup

**1. Install dependencies**

```bash
cd contest-system
npm install
```

**2. Configure environment**

```bash
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/contest_db
SESSION_SECRET=any_long_random_string_at_least_32_chars
PORT=3000
ONECOMPILER_API_KEY=your_key_here
```

**3. Create the database**

In pgAdmin: right-click **Databases** → **Create** → name it `contest_db` → Save.

**4. Load the schema**

In pgAdmin: **Tools** → **Query Tool** → open `db/schema.sql` → press **F5**

**5. (Optional) Load seed data**

Open `db/seed.sql` → press **F5**. Creates sample users, a contest, problems, and test submissions.

**6. Start the server**

```bash
node server.js
```

**7. Verify**

```
GET http://localhost:3000/api/health
→ { "status": "ok", "db": "connected" }
```

---

## Project Structure

```
contest-system/
├── server.js                     # Entry point — Express app setup
├── .env                          # Environment variables (never commit)
├── .env.example                  # Safe template for .env
├── package.json
│
├── db/
│   ├── pool.js                   # PostgreSQL connection pool
│   ├── schema.sql                # All tables, indexes, views, triggers, stored procs
│   └── seed.sql                  # Sample data for testing
│
├── routes/
│   ├── auth.js                   # /api/auth/*
│   ├── users.js                  # /api/users/*
│   ├── profile.js                # /api/profile/*
│   ├── contests.js               # /api/contests/*
│   └── problems.js               # /api/contests/:id/problems/*
│
├── controllers/
│   ├── authController.js
│   ├── userController.js
│   ├── profileController.js
│   ├── contestController.js
│   └── problemController.js
│
├── middleware/
│   └── auth.js                   # requireAuth, setLastSeen
│
├── services/
│   └── judge.js                  # OneCompiler API + judging logic
│
└── public/                       # Static frontend files
    ├── index.html                # Home / profile dashboard
    ├── login.html
    ├── register.html
    ├── users.html
    ├── profile.html              # Public profile  (?username=)
    ├── contests.html
    ├── create-contest.html       # Two-step: contest info → add problems
    ├── contest.html              # Contest view    (?id=)
    ├── problem.html              # Problem solving (?contestId=&problemId=)
    ├── leaderboard.html          # ICPC leaderboard (?id=)
    ├── manager.html              # Manager panel   (?id=)
    ├── css/
    │   └── style.css
    └── js/
        ├── api.js                # Shared fetch wrapper (401 → /login)
        ├── addProblem.js         # Shared add-problem form module
        └── toast.js
```

---

## Database Schema

9 tables defined in `db/schema.sql`.

| Table | Purpose |
|-------|---------|
| `users` | Accounts — username, email, password hash, streak counters, online status |
| `contests` | Contest metadata — name, times, password hash, creator FK, is_ended flag |
| `contest_participants` | Junction: users joined to contests |
| `problems` | Custom problems — statement, formats, constraints, hints, limits |
| `contest_problems` | Junction: problems in contests with label (A, B, C…) |
| `test_cases` | Sample and hidden test cases for problems |
| `submissions` | All code submissions — verdict, language, code, execution time |
| `user_daily_activity` | One row per user per active day — drives streak calculation |
| `contest_scores` | Cached solved count + penalty per user per contest |

### Required SQL Objects (CS 2005 requirement)

| Type | Name | Purpose |
|------|------|---------|
| VIEW | `leaderboard_view` | ICPC rank, solved count, penalty per user per contest |
| VIEW | `user_stats_view` | Aggregated per-user stats (solved, attempted, streaks) |
| TRIGGER | `update_streak_trigger` | Fires on `submissions` INSERT — updates activity + streak |
| STORED PROC | `submit_and_score()` | Atomic: insert submission + update contest_scores |
| STORED PROC | `get_user_profile()` | Returns full profile stats in one call |
| INDEXES | multiple | submissions, contest_participants, users, user_daily_activity |

---

## Notes

- All SQL queries use parameterized placeholders (`$1, $2`) — no string interpolation.
- `password_hash` is never returned in any API response.
- Manager-only endpoints verify `req.session.userId === contest.created_by`.
- Hidden test cases are never returned to non-manager users.
- Judging is always asynchronous — HTTP response is returned before judging completes.
- Only the first Accepted submission counts for scoring.
- Ended contests do not appear on the contests list page.

---

**CS 2005 — Database Systems · May 2026**
