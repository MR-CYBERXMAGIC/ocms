-- Phase 10 migration — run in pgAdmin Query Tool

-- 1. is_blocked column on contest_participants
ALTER TABLE contest_participants ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE;

-- 2. Add 'External' to submissions verdict check
DO $$
BEGIN
  BEGIN
    ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_verdict_check;
    ALTER TABLE submissions ADD CONSTRAINT submissions_verdict_check
      CHECK (verdict IN (
        'Pending','In Progress','Accepted','Wrong Answer',
        'Time Limit Exceeded','Runtime Error','Compilation Error','External'
      ));
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Constraint update skipped: %', SQLERRM;
  END;
END $$;

-- 3. Stored procedure to recalculate all scores for a contest from scratch
CREATE OR REPLACE PROCEDURE recalculate_contest_scores(p_contest_id INT) AS $$
DECLARE
  v_row        RECORD;
  v_ac_time    TIMESTAMPTZ;
  v_start_time TIMESTAMPTZ;
  v_minutes    INT;
  v_wrong      INT;
BEGIN
  -- Reset all scores
  UPDATE contest_scores SET solved = 0, penalty = 0
  WHERE contest_id = p_contest_id;

  SELECT start_time INTO v_start_time FROM contests WHERE id = p_contest_id;

  -- For each unique (user, problem) AC pair, add score
  FOR v_row IN
    SELECT DISTINCT user_id, problem_id FROM submissions
    WHERE contest_id = p_contest_id AND verdict = 'Accepted'
  LOOP
    -- First AC time
    SELECT MIN(submitted_at) INTO v_ac_time
    FROM submissions
    WHERE contest_id = p_contest_id AND user_id = v_row.user_id
      AND problem_id = v_row.problem_id AND verdict = 'Accepted';

    v_minutes := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_ac_time - v_start_time)) / 60));

    -- WA before first AC (CE excluded)
    SELECT COUNT(*) INTO v_wrong
    FROM submissions
    WHERE contest_id = p_contest_id AND user_id = v_row.user_id
      AND problem_id = v_row.problem_id AND verdict = 'Wrong Answer'
      AND submitted_at < v_ac_time;

    INSERT INTO contest_scores (contest_id, user_id, solved, penalty)
    VALUES (p_contest_id, v_row.user_id, 0, 0)
    ON CONFLICT (contest_id, user_id) DO NOTHING;

    UPDATE contest_scores
    SET solved  = solved  + 1,
        penalty = penalty + v_minutes + (20 * v_wrong)
    WHERE contest_id = p_contest_id AND user_id = v_row.user_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
