-- ================================================================
-- schema.sql  —  Online Programming Contest Management System
-- PostgreSQL 14+
-- Run:  psql -d contest_db -f db/schema.sql
-- ================================================================

-- ================================================================
-- SECTION 1: USERS
-- Stores account info, online presence, and activity streaks.
-- ================================================================
CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL    PRIMARY KEY,
  full_name       TEXT         NOT NULL,
  username        TEXT         NOT NULL UNIQUE,
  email           TEXT         NOT NULL UNIQUE,
  password_hash   TEXT         NOT NULL,
  last_seen       TIMESTAMPTZ  DEFAULT NOW(),
  is_online       BOOLEAN      NOT NULL DEFAULT FALSE,
  current_streak  INT          NOT NULL DEFAULT 0 CHECK (current_streak  >= 0),
  longest_streak  INT          NOT NULL DEFAULT 0 CHECK (longest_streak  >= 0),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ================================================================
-- SECTION 2: CONTESTS
-- password_hash NULL → public contest (no password required).
-- duration_minutes must be positive.
-- ================================================================
CREATE TABLE IF NOT EXISTS contests (
  id               BIGSERIAL    PRIMARY KEY,
  name             TEXT         NOT NULL UNIQUE,
  description      TEXT,
  password_hash    TEXT,
  start_time       TIMESTAMPTZ  NOT NULL,
  duration_minutes INT          NOT NULL CHECK (duration_minutes > 0),
  created_by       BIGINT       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_ended         BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ================================================================
-- SECTION 3: CONTEST PARTICIPANTS
-- Records which users have joined which contest.
-- ================================================================
CREATE TABLE IF NOT EXISTS contest_participants (
  contest_id  BIGINT      NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id     BIGINT      NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contest_id, user_id)
);

-- ================================================================
-- SECTION 4: PROBLEMS
-- type = 'custom'   → statement/test cases stored here
-- type = 'external' → problem lives on platform; source_url required
-- ================================================================
CREATE TABLE IF NOT EXISTS problems (
  id                BIGSERIAL  PRIMARY KEY,
  title             TEXT       NOT NULL,
  type              TEXT       NOT NULL CHECK (type IN ('custom', 'external')),
  platform          TEXT,                    -- e.g. 'Codeforces', 'AtCoder'
  source_url        TEXT,                    -- canonical problem URL
  statement         TEXT,
  input_format      TEXT,
  output_format     TEXT,
  constraints_text  TEXT,
  time_limit_ms     INT        NOT NULL DEFAULT 1000  CHECK (time_limit_ms  > 0),
  memory_limit_mb   INT        NOT NULL DEFAULT 256   CHECK (memory_limit_mb > 0),
  hints             TEXT,
  model_solution    TEXT,
  created_by        BIGINT     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- SECTION 5: CONTEST PROBLEMS
-- Links problems to contests with a single-letter label (A, B, C…).
-- ================================================================
CREATE TABLE IF NOT EXISTS contest_problems (
  contest_id  BIGINT  NOT NULL REFERENCES contests(id)  ON DELETE CASCADE,
  problem_id  BIGINT  NOT NULL REFERENCES problems(id)  ON DELETE RESTRICT,
  label       CHAR(1) NOT NULL CHECK (label ~ '^[A-Z]$'),
  PRIMARY KEY (contest_id, problem_id)
);

-- ================================================================
-- SECTION 6: TEST CASES
-- Hidden test cases are invisible to contestants during the contest.
-- ================================================================
CREATE TABLE IF NOT EXISTS test_cases (
  id               BIGSERIAL PRIMARY KEY,
  problem_id       BIGINT    NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  input            TEXT      NOT NULL,
  expected_output  TEXT      NOT NULL,
  is_hidden        BOOLEAN   NOT NULL DEFAULT FALSE
);

-- ================================================================
-- SECTION 7: SUBMISSIONS
-- contest_id is nullable to support practice submissions outside a contest.
-- verdict defaults to 'Pending' and progresses through the judge pipeline.
-- ================================================================
CREATE TABLE IF NOT EXISTS submissions (
  id                 BIGSERIAL   PRIMARY KEY,
  user_id            BIGINT      NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  contest_id         BIGINT               REFERENCES contests(id)  ON DELETE SET NULL,
  problem_id         BIGINT      NOT NULL REFERENCES problems(id)  ON DELETE CASCADE,
  language           TEXT        NOT NULL,
  code               TEXT        NOT NULL,
  verdict            TEXT        NOT NULL DEFAULT 'Pending'
                       CHECK (verdict IN (
                         'Pending',
                         'In Progress',
                         'Accepted',
                         'Wrong Answer',
                         'Time Limit Exceeded',
                         'Runtime Error',
                         'Compilation Error'
                       )),
  execution_time_ms  INT,
  submitted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- SECTION 8: USER DAILY ACTIVITY
-- One row per (user, date). Inserted by the streak trigger.
-- The ON CONFLICT DO NOTHING guard makes writes idempotent.
-- ================================================================
CREATE TABLE IF NOT EXISTS user_daily_activity (
  user_id        BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_date  DATE    NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (user_id, activity_date)
);

-- ================================================================
-- SECTION 9: CONTEST SCORES
-- Maintained by submit_and_score(); mirrors leaderboard_view for
-- fast reads without a full view scan.
-- ================================================================
CREATE TABLE IF NOT EXISTS contest_scores (
  contest_id  BIGINT  NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id     BIGINT  NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  solved      INT     NOT NULL DEFAULT 0 CHECK (solved  >= 0),
  penalty     INT     NOT NULL DEFAULT 0 CHECK (penalty >= 0),
  PRIMARY KEY (contest_id, user_id)
);

-- ================================================================
-- SECTION 10: INDEXES
-- Cover the most common filter patterns across all hot query paths.
-- ================================================================
CREATE INDEX IF NOT EXISTS idx_submissions_user_id
  ON submissions(user_id);

CREATE INDEX IF NOT EXISTS idx_submissions_contest_id
  ON submissions(contest_id);

CREATE INDEX IF NOT EXISTS idx_submissions_problem_id
  ON submissions(problem_id);

CREATE INDEX IF NOT EXISTS idx_submissions_verdict
  ON submissions(verdict);

CREATE INDEX IF NOT EXISTS idx_submissions_contest_problem
  ON submissions(contest_id, problem_id);

CREATE INDEX IF NOT EXISTS idx_contest_participants_user_id
  ON contest_participants(user_id);

CREATE INDEX IF NOT EXISTS idx_users_username
  ON users(username);

CREATE INDEX IF NOT EXISTS idx_users_email
  ON users(email);

CREATE INDEX IF NOT EXISTS idx_user_daily_activity_user_date
  ON user_daily_activity(user_id, activity_date);

-- ================================================================
-- SECTION 11: VIEW — leaderboard_view
--
-- ICPC-style penalty per (contest_id, user_id):
--   • Only the FIRST accepted submission per problem counts.
--   • penalty = floor(minutes from contest start to first AC)
--              + 20 * (# of 'Wrong Answer' submissions before first AC)
--   • Unsolved problems contribute zero penalty.
-- ================================================================
CREATE OR REPLACE VIEW leaderboard_view AS
WITH first_ac AS (
  -- Earliest AC timestamp per (contest, user, problem)
  SELECT
    s.contest_id,
    s.user_id,
    s.problem_id,
    MIN(s.submitted_at) AS ac_time
  FROM submissions s
  WHERE s.verdict     = 'Accepted'
    AND s.contest_id IS NOT NULL
  GROUP BY s.contest_id, s.user_id, s.problem_id
),
wrong_before_ac AS (
  -- Count Wrong Answer submissions that precede the first AC
  SELECT
    s.contest_id,
    s.user_id,
    s.problem_id,
    COUNT(*) AS wrong_count
  FROM submissions s
  JOIN first_ac fa
    ON  s.contest_id  = fa.contest_id
    AND s.user_id     = fa.user_id
    AND s.problem_id  = fa.problem_id
  WHERE s.verdict        = 'Wrong Answer'
    AND s.submitted_at   < fa.ac_time
  GROUP BY s.contest_id, s.user_id, s.problem_id
),
per_problem AS (
  -- Roll penalty up to per-problem level
  SELECT
    fa.contest_id,
    fa.user_id,
    fa.problem_id,
    FLOOR(
      EXTRACT(EPOCH FROM (fa.ac_time - c.start_time)) / 60.0
    )::INT
    + COALESCE(wba.wrong_count, 0) * 20   AS problem_penalty
  FROM first_ac fa
  JOIN contests c
    ON c.id = fa.contest_id
  LEFT JOIN wrong_before_ac wba
    ON  wba.contest_id = fa.contest_id
    AND wba.user_id    = fa.user_id
    AND wba.problem_id = fa.problem_id
)
SELECT
  pp.contest_id,
  pp.user_id,
  COUNT(*)::INT             AS solved,
  SUM(pp.problem_penalty)::INT AS penalty
FROM per_problem pp
GROUP BY pp.contest_id, pp.user_id;

-- ================================================================
-- SECTION 11.5: VIEW — user_stats_view
--
-- Per-user aggregate stats used by the profile API and the
-- get_user_profile() procedure below.  Re-runnable (CREATE OR REPLACE).
-- ================================================================
CREATE OR REPLACE VIEW user_stats_view AS
SELECT
  u.id,
  u.username,
  u.full_name,
  COUNT(DISTINCT CASE WHEN s.verdict = 'Accepted' THEN s.problem_id END)::INT
    AS problems_solved,
  COUNT(DISTINCT s.problem_id)::INT
    AS problems_attempted,
  ROUND(
    COUNT(DISTINCT CASE WHEN s.verdict = 'Accepted' THEN s.problem_id END)::NUMERIC
    / NULLIF(COUNT(DISTINCT s.problem_id)::NUMERIC, 0) * 100,
    1
  ) AS acceptance_rate,
  u.current_streak,
  u.longest_streak,
  (SELECT COUNT(*)::INT
   FROM contest_participants cp
   WHERE cp.user_id = u.id) AS contests_joined
FROM users u
LEFT JOIN submissions s ON s.user_id = u.id
GROUP BY u.id, u.username, u.full_name, u.current_streak, u.longest_streak;

-- ================================================================
-- SECTION 12: TRIGGER — trg_submission_accepted
--
-- Fires AFTER INSERT on submissions when verdict = 'Accepted'.
-- Steps:
--   1. Insert today into user_daily_activity (idempotent).
--   2. Walk backwards from yesterday counting consecutive active days.
--   3. Write current_streak; bump longest_streak if a new record.
-- ================================================================
CREATE OR REPLACE FUNCTION fn_update_streak_on_accepted()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_today      DATE := CURRENT_DATE;
  v_check      DATE;
  v_streak     INT  := 1;   -- today already counts
BEGIN
  -- Step 1: mark today as active
  INSERT INTO user_daily_activity (user_id, activity_date)
  VALUES (NEW.user_id, v_today)
  ON CONFLICT DO NOTHING;

  -- Step 2: extend streak backwards through consecutive prior days
  v_check := v_today - 1;
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM   user_daily_activity
      WHERE  user_id      = NEW.user_id
        AND  activity_date = v_check
    );
    v_streak := v_streak + 1;
    v_check  := v_check  - 1;
  END LOOP;

  -- Step 3: persist
  UPDATE users
  SET  current_streak = v_streak,
       longest_streak  = GREATEST(longest_streak, v_streak)
  WHERE id = NEW.user_id;

  RETURN NEW;
END;
$$;

-- Drop and recreate so re-running schema.sql is idempotent
DROP TRIGGER IF EXISTS trg_submission_accepted ON submissions;

CREATE TRIGGER trg_submission_accepted
AFTER INSERT ON submissions
FOR EACH ROW
WHEN (NEW.verdict = 'Accepted')
EXECUTE FUNCTION fn_update_streak_on_accepted();

-- ================================================================
-- SECTION 13: STORED PROCEDURE — submit_and_score
--
-- Atomically:
--   1. Inserts the submission row.
--   2. If verdict = 'Accepted' AND no prior AC exists for this
--      (user, contest, problem):
--        a. Fetches contest start time.
--        b. Counts Wrong Answer submissions before this AC.
--        c. Calculates penalty = AC_minutes + 20 * wrong_count.
--        d. Updates contest_scores (solved+1, penalty+delta) under
--           a FOR UPDATE lock to prevent concurrent double-counts.
--
-- The trigger (Section 12) fires automatically inside step 1 to
-- handle the streak update — no duplication needed here.
-- ================================================================
CREATE OR REPLACE PROCEDURE submit_and_score(
  p_user_id    BIGINT,
  p_contest_id BIGINT,
  p_problem_id BIGINT,
  p_language   TEXT,
  p_code       TEXT,
  p_verdict    TEXT,
  p_exec_time  INT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_new_id        BIGINT;
  v_prior_ac      BOOLEAN;
  v_wrong_count   INT;
  v_start_time    TIMESTAMPTZ;
  v_ac_minutes    INT;
  v_add_penalty   INT;
BEGIN
  -- 1. Record the submission
  INSERT INTO submissions (
    user_id, contest_id, problem_id,
    language, code, verdict, execution_time_ms, submitted_at
  ) VALUES (
    p_user_id, p_contest_id, p_problem_id,
    p_language, p_code, p_verdict, p_exec_time, NOW()
  )
  RETURNING id INTO v_new_id;

  -- 2. Nothing more to do unless this is an Accepted verdict
  IF p_verdict <> 'Accepted' THEN
    RETURN;
  END IF;

  -- 3. Guard: skip if a prior AC already exists (avoid double-counting)
  SELECT EXISTS (
    SELECT 1
    FROM   submissions
    WHERE  user_id    = p_user_id
      AND  contest_id = p_contest_id
      AND  problem_id = p_problem_id
      AND  verdict    = 'Accepted'
      AND  id        <> v_new_id
  ) INTO v_prior_ac;

  IF v_prior_ac THEN
    RETURN;
  END IF;

  -- 4. Contest start time for time-penalty calculation
  SELECT start_time INTO v_start_time
  FROM   contests
  WHERE  id = p_contest_id;

  -- 5. Count WA submissions for this (user, contest, problem) before this AC
  SELECT COUNT(*) INTO v_wrong_count
  FROM   submissions
  WHERE  user_id    = p_user_id
    AND  contest_id = p_contest_id
    AND  problem_id = p_problem_id
    AND  verdict    = 'Wrong Answer'
    AND  id        <> v_new_id;

  -- 6. ICPC penalty
  v_ac_minutes  := FLOOR(EXTRACT(EPOCH FROM (NOW() - v_start_time)) / 60.0)::INT;
  v_add_penalty := v_ac_minutes + v_wrong_count * 20;

  -- 7. Ensure the score row exists (idempotent), then lock it to serialise
  --    concurrent AC submissions for the same user in the same contest.
  INSERT INTO contest_scores (contest_id, user_id, solved, penalty)
  VALUES (p_contest_id, p_user_id, 0, 0)
  ON CONFLICT DO NOTHING;

  PERFORM 1
  FROM   contest_scores
  WHERE  contest_id = p_contest_id AND user_id = p_user_id
  FOR UPDATE;

  -- 8. Increment solved count and add this problem's penalty contribution.
  UPDATE contest_scores
  SET    solved  = solved  + 1,
         penalty = penalty + v_add_penalty
  WHERE  contest_id = p_contest_id AND user_id = p_user_id;
END;
$$;

-- ================================================================
-- SECTION 14: FUNCTION — get_user_profile
--
-- Returns all profile stats for a given username in one call,
-- backed by user_stats_view.  STABLE — reads only, no side-effects.
-- ================================================================
CREATE OR REPLACE FUNCTION get_user_profile(p_username TEXT)
RETURNS TABLE (
  id                 BIGINT,
  username           TEXT,
  full_name          TEXT,
  problems_solved    INT,
  problems_attempted INT,
  acceptance_rate    NUMERIC,
  current_streak     INT,
  longest_streak     INT,
  contests_joined    INT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    usv.id,
    usv.username,
    usv.full_name,
    usv.problems_solved,
    usv.problems_attempted,
    usv.acceptance_rate,
    usv.current_streak,
    usv.longest_streak,
    usv.contests_joined
  FROM user_stats_view usv
  WHERE usv.username = p_username;
$$;
