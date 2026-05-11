-- Phase 9 migration — run in pgAdmin Query Tool

-- 1. Add columns to problems table
ALTER TABLE problems ADD COLUMN IF NOT EXISTS fetch_status VARCHAR(10) DEFAULT 'pending';
ALTER TABLE problems ADD COLUMN IF NOT EXISTS sample_cases JSONB DEFAULT '[]';

-- 2. Add 'Compilation Error' to submissions verdict check
--    (drops old constraint and recreates it with CE included)
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_verdict_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_verdict_check
  CHECK (verdict IN (
    'Pending', 'In Progress', 'Accepted',
    'Wrong Answer', 'Time Limit Exceeded',
    'Runtime Error', 'Compilation Error'
  ));

-- 3. Create/replace submit_and_score() stored procedure
--    CE does NOT add penalty; only WA on eventually-solved problems counts.
CREATE OR REPLACE PROCEDURE submit_and_score(
  p_submission_id INT,
  p_verdict       VARCHAR
) AS $$
DECLARE
  v_user_id     INT;
  v_contest_id  INT;
  v_problem_id  INT;
  v_start_time  TIMESTAMPTZ;
  v_minutes     INT;
  v_wrong       INT;
  v_already_ac  INT;
BEGIN
  SELECT user_id, contest_id, problem_id, submitted_at
  INTO   v_user_id, v_contest_id, v_problem_id, v_start_time
  FROM   submissions
  WHERE  id = p_submission_id;

  UPDATE submissions SET verdict = p_verdict WHERE id = p_submission_id;

  IF p_verdict = 'Accepted' THEN

    SELECT COUNT(*) INTO v_already_ac
    FROM submissions
    WHERE user_id   = v_user_id
      AND contest_id  = v_contest_id
      AND problem_id  = v_problem_id
      AND verdict     = 'Accepted'
      AND id         != p_submission_id;

    IF v_already_ac = 0 THEN

      SELECT FLOOR(
               EXTRACT(EPOCH FROM (NOW() -
                 (SELECT start_time FROM contests WHERE id = v_contest_id))) / 60
             )
      INTO v_minutes;
      v_minutes := GREATEST(0, v_minutes);

      -- Only Wrong Answer counts toward penalty; CE is excluded on purpose
      SELECT COUNT(*) INTO v_wrong
      FROM submissions
      WHERE user_id   = v_user_id
        AND contest_id  = v_contest_id
        AND problem_id  = v_problem_id
        AND verdict     = 'Wrong Answer'
        AND id         != p_submission_id;

      INSERT INTO contest_scores (contest_id, user_id, solved, penalty)
      VALUES (v_contest_id, v_user_id, 0, 0)
      ON CONFLICT (contest_id, user_id) DO NOTHING;

      UPDATE contest_scores
      SET solved  = solved  + 1,
          penalty = penalty + v_minutes + (20 * v_wrong)
      WHERE contest_id = v_contest_id
        AND user_id    = v_user_id;

    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;
