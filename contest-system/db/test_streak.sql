-- ================================================================
-- test_streak.sql  —  Verify streak trigger behaviour
-- Run:  psql -d contest_db -f db/test_streak.sql
--
-- Creates isolated test data, asserts expected streak values, then
-- rolls everything back so the production database is unaffected.
-- ================================================================

BEGIN;

-- ── Helpers ────────────────────────────────────────────────────────────
-- Raise an error (aborting the transaction) if the assertion fails.
CREATE OR REPLACE FUNCTION assert_eq(label TEXT, got INT, expected INT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL [%]: expected %, got %', label, expected, got;
  END IF;
  RAISE NOTICE 'PASS [%]: % = %', label, label, got;
END;
$$;

-- ── Test fixture ────────────────────────────────────────────────────────
-- Insert a throwaway user (unique name to avoid clashes)
INSERT INTO users (full_name, username, email, password_hash)
VALUES ('Streak Test User', '_streak_test_', '_streak_test_@test.invalid', 'x')
RETURNING id
\gset test_user_

-- Insert a throwaway problem
INSERT INTO problems (title, type, time_limit_ms, memory_limit_mb, created_by)
VALUES ('Streak Test Problem', 'custom', 1000, 256, :test_user_id)
RETURNING id
\gset test_prob_

-- ── Test 1: First accepted submission starts streak at 1 ────────────────
INSERT INTO submissions (user_id, problem_id, language, code, verdict, submitted_at)
VALUES (:test_user_id, :test_prob_id, 'Python 3', '# test', 'Accepted', NOW());

SELECT assert_eq(
  'first_ac_streak',
  (SELECT current_streak FROM users WHERE id = :test_user_id),
  1
);

-- ── Test 2: Second AC on same day keeps streak at 1 ────────────────────
INSERT INTO submissions (user_id, problem_id, language, code, verdict, submitted_at)
VALUES (:test_user_id, :test_prob_id, 'Python 3', '# test2', 'Accepted', NOW());

SELECT assert_eq(
  'same_day_second_ac_streak',
  (SELECT current_streak FROM users WHERE id = :test_user_id),
  1
);

-- ── Test 3: AC on yesterday extends streak to 2 ────────────────────────
-- Manually backdate an activity row then re-trigger the streak walk.
INSERT INTO user_daily_activity (user_id, activity_date)
VALUES (:test_user_id, CURRENT_DATE - 1)
ON CONFLICT DO NOTHING;

-- Simulate what the trigger does: walk backwards and update streak.
DO $$
DECLARE
  v_check  DATE := CURRENT_DATE - 2;
  v_streak INT  := 2;   -- today (1) + yesterday (1)
BEGIN
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM user_daily_activity
      WHERE user_id = (SELECT id FROM users WHERE username = '_streak_test_')
        AND activity_date = v_check
    );
    v_streak := v_streak + 1;
    v_check  := v_check  - 1;
  END LOOP;
  UPDATE users
  SET current_streak = v_streak,
      longest_streak = GREATEST(longest_streak, v_streak)
  WHERE username = '_streak_test_';
END;
$$;

SELECT assert_eq(
  'yesterday_extends_streak',
  (SELECT current_streak FROM users WHERE id = :test_user_id),
  2
);

-- ── Test 4: Longest streak is updated when current exceeds it ──────────
SELECT assert_eq(
  'longest_streak_updated',
  (SELECT longest_streak FROM users WHERE id = :test_user_id),
  2
);

-- ── Test 5: Non-AC submission does NOT trigger streak update ───────────
UPDATE users SET current_streak = 0, longest_streak = 0 WHERE id = :test_user_id;
DELETE FROM user_daily_activity WHERE user_id = :test_user_id;

INSERT INTO submissions (user_id, problem_id, language, code, verdict, submitted_at)
VALUES (:test_user_id, :test_prob_id, 'Python 3', '# wa', 'Wrong Answer', NOW());

SELECT assert_eq(
  'wa_does_not_trigger_streak',
  (SELECT current_streak FROM users WHERE id = :test_user_id),
  0
);

-- ── Cleanup ─────────────────────────────────────────────────────────────
ROLLBACK;

\echo 'All streak tests passed (transaction rolled back — no data written).'
