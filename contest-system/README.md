<div align="center">

```
 ██████╗  ██████╗███╗   ███╗███████╗
██╔═══██╗██╔════╝████╗ ████║██╔════╝
██║   ██║██║     ██╔████╔██║███████╗
██║   ██║██║     ██║╚██╔╝██║╚════██║
╚██████╔╝╚██████╗██║ ╚═╝ ██║███████║
 ╚═════╝  ╚═════╝╚═╝     ╚═╝╚══════╝
```

# Online Contest Management System

**A full-stack programming contest platform inspired by VJudge**

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com)
[![HTML/CSS/JS](https://img.shields.io/badge/Frontend-HTML%2FCSS%2FJS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](/)
[![Course](https://img.shields.io/badge/CS_2005-Database_Systems-6C63FF?style=flat-square)](/)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Database Schema](#-database-schema)
- [Required SQL Objects](#-required-sql-objects)
- [API Reference](#-api-reference)
- [Frontend Pages](#-frontend-pages)
- [ICPC Scoring](#-icpc-scoring)
- [Judging Pipeline](#-judging-pipeline)
- [External APIs](#-external-apis)
- [Environment Variables](#-environment-variables)
- [Submission Verdicts](#-submission-verdicts)
- [Development Rules](#-development-rules)
- [HTTP Status Codes](#-http-status-codes)

---

## 🧠 Overview

OCMS is a web-based programming contest management system built from scratch for **CS 2005 – Database Systems** (May 2026). It is inspired by [VJudge](https://vjudge.net) and allows any registered user to:

- **Create** public or password-protected programming contests
- **Add problems** from external platforms (CSES, CodeChef, HackerRank, USACO) or build custom ones with full test case management
- **Submit code** and get real-time verdicts via the OneCompiler API
- **Compete** through ICPC-style leaderboards with live penalty scoring
- **Track** personal statistics — streaks, acceptance rate, contest history

There is a **single user role**. Every registered user can both create and participate in contests. The creator of a contest automatically becomes its **Contest Manager** with full administrative control.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔐 **Authentication** | Register/login with username or email. Passwords hashed with bcrypt. |
| 🏆 **Contest Management** | Create contests with name, password, start time, duration, and description. |
| ➕ **Problem Addition** | Add external problems (URL + platform) or custom problems (full statement + test cases). |
| ⚡ **Real-time Judging** | Custom problems judged via OneCompiler API. Async pipeline with live polling. |
| 📊 **ICPC Leaderboard** | Live leaderboard with penalty scoring. Refreshes every 30s during active contests. |
| 🔥 **Streak Tracking** | Daily streaks auto-calculated via PostgreSQL trigger on every Accepted submission. |
| 👤 **User Profiles** | Public profiles with stats, streaks, contest history, recent accepted submissions. |
| 🌐 **External Problems** | Import from CSES, CodeChef, HackerRank, USACO. Metadata stored locally. |
| 🛡️ **Manager Panel** | View all submissions + code, per-problem stats, edit contest, end early. |
| 🔍 **User Search** | Real-time search/filter on the users page. Sorted by problems solved. |
| 📁 **Bulk Test Cases** | Upload test cases via CSV for custom problems. |

---

## 🛠 Tech Stack

```
Backend       Node.js + Express.js
Database      PostgreSQL 14+
Frontend      Plain HTML / CSS / JavaScript (no framework)
Auth          express-session + bcrypt
DB Driver     node-postgres (pg)
Code Editor   CodeMirror 5 (CDN)
Judge API     OneCompiler API
```

---

## 📁 Project Structure

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
│   ├── auth.js                   # POST /api/auth/*
│   ├── users.js                  # GET  /api/users/*
│   ├── profile.js                # GET  /api/profile/me
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
    ├── create-contest.html
    ├── contest.html              # Contest view    (?id=)
    ├── problem.html              # Problem solving (?contestId=&problemId=)
    ├── leaderboard.html          # ICPC leaderboard (?id=)
    ├── manager.html              # Manager panel   (?id=)
    ├── css/
    │   └── style.css
    └── js/
        └── api.js                # Shared fetch wrapper (handles 401 → /login)
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js v18+
- PostgreSQL 14+
- pgAdmin (recommended for Windows users)
- A free [OneCompiler API key](https://onecompiler.com)

### Step-by-step Setup

**1. Install dependencies**

```bash
cd contest-system
npm install
```

**2. Configure environment**

```bash
# Copy the example file
cp .env.example .env
```

Then edit `.env`:

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

> This creates all 9 tables, 6+ indexes, 2 views, 1 trigger, and 2 stored procedures.

**5. Load seed data** *(optional)*

In pgAdmin: open `db/seed.sql` → press **F5**

Creates 3 sample users, 1 contest, 2 problems, and test submissions.

**6. Start the server**

```bash
node server.js
```

**7. Verify it's working**

Open `http://localhost:3000/api/health` — you should see:

```json
{ "status": "ok", "db": "connected" }
```

---

## 🗄 Database Schema

The system uses **9 PostgreSQL tables** defined in `db/schema.sql`.

### Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts — username, email, password hash, streak counters, online status |
| `contests` | Contest metadata — name, times, password hash, creator FK, is_ended flag |
| `contest_participants` | Junction: which users joined which contest |
| `problems` | All problems — custom (full statement) and external (URL + platform only) |
| `contest_problems` | Junction: problems in contests with label A/B/C/… |
| `test_cases` | Sample and hidden test cases for custom problems |
| `submissions` | All code submissions — verdict, language, code, execution time, timestamp |
| `user_daily_activity` | One row per user per active day — drives streak calculation |
| `contest_scores` | Cached solved count + penalty per user per contest (leaderboard source) |

### Key Relationships

```
users ──< contests              (one user creates many contests)
users ──< contest_participants  (many-to-many with contests)
users ──< submissions

contests ──< contest_problems   (many-to-many with problems)
problems ──< test_cases         (one problem has many test cases)
problems ──< contest_problems

submissions >── users
submissions >── contests
submissions >── problems
```

---

## 🔧 Required SQL Objects

These are required by the CS 2005 course spec and all exist in `db/schema.sql`.

### Views

```sql
-- Computes ICPC rank, solved count, and penalty from raw submissions
CREATE VIEW leaderboard_view AS ...

-- Aggregated per-user stats: solved, attempted, acceptance rate, streaks
CREATE VIEW user_stats_view AS ...
```

### Trigger

```sql
-- Fires after every INSERT on submissions WHERE verdict = 'Accepted'
-- → inserts into user_daily_activity (ON CONFLICT DO NOTHING)
-- → recalculates current_streak (consecutive days ending today)
-- → updates longest_streak if current > longest
CREATE TRIGGER update_streak_trigger
AFTER INSERT ON submissions ...
```

### Stored Procedures

```sql
-- Atomic transaction: insert submission + update contest_scores
-- Called from Node.js as: CALL submit_and_score($1,$2,$3,$4,$5,$6,$7)
CREATE PROCEDURE submit_and_score(
  p_user_id, p_contest_id, p_problem_id,
  p_language, p_code, p_verdict, p_exec_time
) ...

-- Returns all profile stats for a given username in one call
CREATE PROCEDURE get_user_profile(p_username TEXT) ...
```

### Indexes

```sql
CREATE INDEX ON submissions(user_id);
CREATE INDEX ON submissions(contest_id, problem_id);
CREATE INDEX ON submissions(verdict);
CREATE INDEX ON contest_participants(user_id);
CREATE INDEX ON users(username);
CREATE INDEX ON users(email);
CREATE INDEX ON user_daily_activity(user_id, activity_date);
```

---

## 📡 API Reference

All endpoints return JSON. Authentication uses `express-session`.

> 🔒 = requires login &nbsp;|&nbsp; 👑 = requires contest manager role

### Auth `/api/auth`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Register with full name, username, email, password |
| `POST` | `/api/auth/login` | Login with username or email + password |
| `POST` | `/api/auth/logout` | Destroy session |
| `GET`  | `/api/auth/me` | Return current session user or `401` |

### Users `/api/users`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/users` | All users sorted (solved DESC, online first, username A–Z). Accepts `?search=` |
| `GET` | `/api/users/:username` | Public profile — stats, streaks, contest history, recent AC submissions |
| `GET` | `/api/profile/me` 🔒 | Full profile for logged-in user including acceptance rate |

### Contests `/api/contests`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET`  | `/api/contests` | — | All running + upcoming contests |
| `POST` | `/api/contests` | 🔒 | Create a new contest |
| `GET`  | `/api/contests/:id` | — | Contest detail + problems list |
| `POST` | `/api/contests/:id/join` | 🔒 | Join (accepts password if protected) |
| `GET`  | `/api/contests/:id/leaderboard` | 🔒 | ICPC leaderboard for this contest |
| `GET`  | `/api/contests/:id/manager/submissions` | 👑 | All submissions from all participants |
| `GET`  | `/api/contests/:id/manager/stats` | 👑 | Per-problem solve statistics |
| `PATCH`| `/api/contests/:id` | 👑 | Edit name, description, password |
| `POST` | `/api/contests/:id/end` | 👑 | End contest early |

### Problems `/api/contests/:id/problems`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET`    | `/` | 🔒 | List problems with user's status per problem |
| `POST`   | `/` | 👑 | Add problem (custom or external) |
| `DELETE` | `/:problemId` | 👑 | Remove problem (before contest starts only) |
| `GET`    | `/:problemId` | 🔒 | Full problem detail (no hidden test cases) |
| `POST`   | `/:problemId/submit` | 🔒 | Submit code for judging |
| `GET`    | `/:problemId/submissions` | 🔒 | User's own submission history |
| `POST`   | `/:problemId/testcases/bulk` | 👑 | Bulk CSV upload of test cases |

### Submissions `/api/submissions`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/submissions/:id` | Full submission detail |
| `GET` | `/api/submissions/:id/status` | Verdict only — for frontend polling |

---

## 🏅 ICPC Scoring

Each contest uses ICPC-style scoring. Rank is determined first by **most problems solved**, then by **least penalty time**.

### How Penalty Works

```
penalty = Σ (AC_time_in_minutes + 20 × wrong_attempts_before_AC)
          for each problem that was eventually solved
```

> ⚠️ Wrong attempts on **unsolved** problems add **zero** penalty.

### Example

```
Problem A: solved at 45min, 1 wrong attempt before → 45 + 20 = 65 min
Problem B: solved at 80min, 0 wrong attempts       → 80 + 0  = 80 min
Problem C: NOT solved, 3 wrong attempts             →           0 min (ignored)

Total: solved = 2, penalty = 145 min
```

### Tiebreaker Order

```
1. Most problems solved  (higher = better rank)
2. Least penalty time    (lower  = better rank)
3. Username A–Z          (alphabetical tiebreak)
```

---

## ⚙️ Judging Pipeline

### Custom Problems (OneCompiler API)

```
User submits code
       │
       ▼
INSERT submission (verdict = 'Pending')  ← HTTP response returned here
       │
       ▼  (async, background)
Fetch hidden test cases from DB
       │
       ▼
For each test case (up to 3 parallel):
  POST to OneCompiler API
  Compare stdout ↔ expected_output (trimmed)
       │
       ├─ mismatch          → Wrong Answer
       ├─ exec > time_limit → Time Limit Exceeded
       ├─ stderr present    → Runtime Error
       └─ all pass          → Accepted
       │
       ▼
CALL submit_and_score()  ← atomic transaction
  INSERT submission with final verdict
  UPDATE contest_scores (if first AC on this problem)
       │
       ▼
Frontend polls GET /api/submissions/:id/status
every 2 seconds until verdict resolved
```

### External Problems

For problems from CSES, CodeChef, HackerRank, or USACO — only metadata (title, URL, platform) is stored locally. Submissions are forwarded to the platform. Verdict stored as received.

### Language Map

| Displayed | OneCompiler Code |
|-----------|-----------------|
| C++17 | `cpp` |
| Python 3 | `python` |
| Java | `java` |
| C | `c` |

---

## 🌐 External APIs

### OneCompiler API

```
Endpoint  POST https://onecompiler.com/api/v1/run
Auth      X-API-Key header
Body      { language, stdin, files: [{ name, content }] }
Response  { status, stdout, stderr, executionTime }
Parallel  Up to 3 test cases run concurrently via Promise.all
```

### External Platforms

| Platform | Problems Imported | Verdict Source |
|----------|------------------|----------------|
| CSES | ✅ URL + title | Platform judge |
| CodeChef | ✅ URL + title | Platform judge |
| HackerRank | ✅ URL + title | Platform judge |
| USACO | ✅ URL + title | Platform judge |

---

## 🔑 Environment Variables

Create `.env` in the `contest-system/` root. Never commit this file.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ Yes | PostgreSQL connection string |
| `SESSION_SECRET` | ✅ Yes | Long random string for session cookie signing (32+ chars) |
| `PORT` | No | Server port. Defaults to `3000` |
| `ONECOMPILER_API_KEY` | ✅ Yes | API key for OneCompiler judging |

**Example `.env`:**

```env
DATABASE_URL=postgresql://postgres:mypassword@localhost:5432/contest_db
SESSION_SECRET=s3cr3t_l0ng_r4nd0m_str1ng_g0_here_please
PORT=3000
ONECOMPILER_API_KEY=oc_api_xxxxxxxxxxxx
```

---

## 💻 Frontend Pages

| Page | URL | Description |
|------|-----|-------------|
| Home / Dashboard | `/index.html` | Problems solved, streaks, acceptance rate, recent submissions, contest history |
| Login | `/login.html` | Login with username or email |
| Register | `/register.html` | Sign up with full name, unique username, email, password |
| Users | `/users.html` | All users table sorted by solved DESC. Real-time search filter |
| Public Profile | `/profile.html?username=` | Public stats, streaks, contest history, recent AC submissions (no code) |
| Contests | `/contests.html` | Running + upcoming contests. Create Contest button |
| Create Contest | `/create-contest.html` | Two-step form: contest info → add problems |
| Contest View | `/contest.html?id=` | Problem table, countdown timer, join, user stats panel |
| Problem Solving | `/problem.html?contestId=&problemId=` | Split pane: statement left, CodeMirror editor right |
| Leaderboard | `/leaderboard.html?id=` | ICPC table, auto-refresh 30s during live contests |
| Manager Panel | `/manager.html?id=` | All submissions, problem stats, edit contest, end early |

### Frontend Conventions

- All API calls use `public/js/api.js` — a shared fetch wrapper
- `401` responses automatically redirect to `/login.html`
- Native `fetch()` only — no jQuery, no axios
- CodeMirror 5 loaded from CDN (`cdnjs.cloudflare.com`)
- Error messages shown **inline** — never `alert()`
- Timestamps shown as relative time ("3 minutes ago")

---

## 🟢 Submission Verdicts

| Verdict | Short | Meaning | Badge Color |
|---------|-------|---------|-------------|
| Accepted | `AC` | All test cases passed | 🟢 Green |
| Wrong Answer | `WA` | Output doesn't match expected | 🔴 Red |
| Time Limit Exceeded | `TLE` | Execution too slow | 🟠 Orange |
| Runtime Error | `RE` | Program crashed | 🟣 Purple |
| Compilation Error | `CE` | Code didn't compile | ⚪ Gray |
| Pending | — | Waiting in judge queue | ⚫ Dark gray |
| In Progress | — | Currently being judged | ⚫ Dark gray |

---

## 📐 Development Rules

> These rules must be followed in all code changes.

1. **Parameterized queries only.** All SQL must use `$1, $2` placeholders. Never string interpolation. No exceptions.

2. **Never expose `password_hash`.** Strip it from every API response — including accidental joins on the `users` table.

3. **Manager check on every manager endpoint.** Verify `req.session.userId === contest.created_by`. Return `403` if not.

4. **Judging is always async.** Never block the HTTP response waiting for OneCompiler. Insert as Pending → judge in background → client polls.

5. **Hidden test cases never exposed.** `GET /problems/:id` must filter out `is_hidden = true` rows for non-managers.

6. **Contest passwords stored hashed.** bcrypt only. Never return the hash or plaintext in any response.

7. **Only first AC counts for scoring.** `submit_and_score()` must check for a prior Accepted before updating `contest_scores`.

8. **Ended contests off the list.** `GET /api/contests` excludes contests where `is_ended = true` or end time has passed.

9. **Every route has try/catch.** Return `{ error: message }` with the correct HTTP status — no unhandled exceptions.

10. **Labels fixed after start.** Problem labels (A, B, C…) cannot be reassigned once a contest has started.

---

## 📊 HTTP Status Codes

| Code | Meaning | When to use |
|------|---------|-------------|
| `200` | OK | Successful GET, PATCH |
| `201` | Created | Successful POST (new resource) |
| `400` | Bad Request | Validation errors, missing fields |
| `401` | Unauthorized | No session / not logged in |
| `403` | Forbidden | Logged in but not authorized (e.g. not manager) |
| `404` | Not Found | Resource doesn't exist |
| `409` | Conflict | Duplicate username, contest name already taken |
| `500` | Server Error | Unexpected DB or server crash |

---

<div align="center">

**CS 2005 — Database Systems &nbsp;·&nbsp; May 2026**

*Built with Node.js · Express · PostgreSQL · Plain HTML/CSS/JS*

</div>
