-- ================================================================
-- seed.sql  —  Sample data for development / testing
-- Run AFTER schema.sql:  psql -d contest_db -f db/seed.sql
--
-- Passwords (bcrypt rounds=10):
--   alice_dev   → alice123
--   bob_dev     → bob456
--   charlie_dev → charlie789
-- ================================================================

-- ================================================================
-- USERS  (3 sample accounts)
-- ================================================================
INSERT INTO users (full_name, username, email, password_hash)
VALUES
  ('Alice Dev',
   'alice_dev',
   'alice@example.com',
   '$2b$10$yAIl0r9BTXjHnUYCHxNube5s5gxz9vJ4BlUqkGvaJrmk/360.lWnu'),

  ('Bob Dev',
   'bob_dev',
   'bob@example.com',
   '$2b$10$0LGYpSxW8ctvf9Wi6v8MKuG7TiA/dbFQuHApHY3lbx4SjjBiNj1R2'),

  ('Charlie Dev',
   'charlie_dev',
   'charlie@example.com',
   '$2b$10$KtnkbUCjicUQm6NI/fzrae3rFYAKGnLOXvBrX45xS3U.NRWhuvgQy')
ON CONFLICT DO NOTHING;

-- ================================================================
-- CONTEST  (1 sample contest, created by alice)
-- ================================================================
INSERT INTO contests (name, description, start_time, duration_minutes, created_by)
SELECT
  'Spring Warmup 2026',
  'A beginner-friendly contest covering arrays and strings.',
  NOW() - INTERVAL '2 hours',   -- started 2 hours ago (already running)
  180,                           -- 3-hour contest
  id
FROM users WHERE username = 'alice_dev'
ON CONFLICT DO NOTHING;

-- ================================================================
-- PROBLEMS  (2 sample problems, both created by alice)
-- ================================================================
INSERT INTO problems (
  title, type, statement, input_format, output_format,
  constraints_text, time_limit_ms, memory_limit_mb, created_by
)
SELECT
  'Sum of Two Numbers',
  'custom',
  'Given two integers A and B, print their sum.',
  'A single line containing two space-separated integers A and B.',
  'Print a single integer: the sum of A and B.',
  '1 ≤ A, B ≤ 10^9',
  1000, 256,
  id
FROM users WHERE username = 'alice_dev'
ON CONFLICT DO NOTHING;

INSERT INTO problems (
  title, type, statement, input_format, output_format,
  constraints_text, time_limit_ms, memory_limit_mb, created_by
)
SELECT
  'Reverse a String',
  'custom',
  'Given a string S, print it reversed.',
  'A single line containing string S (no spaces).',
  'Print the reversed string on a single line.',
  '1 ≤ |S| ≤ 10^5',
  1000, 256,
  id
FROM users WHERE username = 'alice_dev'
ON CONFLICT DO NOTHING;

-- ================================================================
-- TEST CASES
-- ================================================================
INSERT INTO test_cases (problem_id, input, expected_output, is_hidden)
SELECT id, '3 5',  '8',  FALSE FROM problems WHERE title = 'Sum of Two Numbers'
ON CONFLICT DO NOTHING;

INSERT INTO test_cases (problem_id, input, expected_output, is_hidden)
SELECT id, '1000000000 999999999', '1999999999', TRUE FROM problems WHERE title = 'Sum of Two Numbers'
ON CONFLICT DO NOTHING;

INSERT INTO test_cases (problem_id, input, expected_output, is_hidden)
SELECT id, 'hello', 'olleh', FALSE FROM problems WHERE title = 'Reverse a String'
ON CONFLICT DO NOTHING;

INSERT INTO test_cases (problem_id, input, expected_output, is_hidden)
SELECT id, 'abcdefghij', 'jihgfedcba', TRUE FROM problems WHERE title = 'Reverse a String'
ON CONFLICT DO NOTHING;

-- ================================================================
-- CONTEST PARTICIPANTS
-- ================================================================
INSERT INTO contest_participants (contest_id, user_id)
SELECT c.id, u.id
FROM contests c, users u
WHERE c.name = 'Spring Warmup 2026'
  AND u.username IN ('alice_dev', 'bob_dev', 'charlie_dev')
ON CONFLICT DO NOTHING;

-- ================================================================
-- CONTEST PROBLEMS  (label A and B)
-- ================================================================
INSERT INTO contest_problems (contest_id, problem_id, label)
SELECT c.id, p.id, 'A'
FROM contests c, problems p
WHERE c.name = 'Spring Warmup 2026'
  AND p.title = 'Sum of Two Numbers'
ON CONFLICT DO NOTHING;

INSERT INTO contest_problems (contest_id, problem_id, label)
SELECT c.id, p.id, 'B'
FROM contests c, problems p
WHERE c.name = 'Spring Warmup 2026'
  AND p.title = 'Reverse a String'
ON CONFLICT DO NOTHING;

-- ================================================================
-- CONTEST SCORES  (initialise rows for all participants)
-- ================================================================
INSERT INTO contest_scores (contest_id, user_id)
SELECT c.id, u.id
FROM contests c, users u
WHERE c.name    = 'Spring Warmup 2026'
  AND u.username IN ('alice_dev', 'bob_dev', 'charlie_dev')
ON CONFLICT DO NOTHING;

-- ================================================================
-- SUBMISSIONS  (mixed verdicts for leaderboard / streak testing)
--
-- Timeline (all within the 3-hour window that started 2 h ago):
--   bob:     WA on A  →  AC on A         (penalty = 30 min + 20 = 50)
--   alice:   AC on A  →  AC on B         (penalty = 15 min + 0  = 15, 45 min + 0 = 45 → total 60)
--   charlie: WA on A  →  TLE on A  →  still Pending on B
-- ================================================================

-- bob: Wrong Answer on problem A  (submitted 90 min ago)
INSERT INTO submissions (user_id, contest_id, problem_id, language, code, verdict, execution_time_ms, submitted_at)
SELECT u.id, c.id, p.id,
       'Python', 'print(int(input()))',
       'Wrong Answer', NULL,
       NOW() - INTERVAL '90 minutes'
FROM users u, contests c, problems p
WHERE u.username = 'bob_dev'
  AND c.name     = 'Spring Warmup 2026'
  AND p.title    = 'Sum of Two Numbers';

-- bob: Accepted on problem A  (submitted 30 min after contest start = 90 min ago context: contest started 2h ago, so 30 min mark)
INSERT INTO submissions (user_id, contest_id, problem_id, language, code, verdict, execution_time_ms, submitted_at)
SELECT u.id, c.id, p.id,
       'Python', 'a,b=map(int,input().split()); print(a+b)',
       'Accepted', 12,
       NOW() - INTERVAL '88 minutes'
FROM users u, contests c, problems p
WHERE u.username = 'bob_dev'
  AND c.name     = 'Spring Warmup 2026'
  AND p.title    = 'Sum of Two Numbers';

-- alice: Accepted on problem A  (submitted 15 min after contest start → ~105 min ago)
INSERT INTO submissions (user_id, contest_id, problem_id, language, code, verdict, execution_time_ms, submitted_at)
SELECT u.id, c.id, p.id,
       'C++', '#include<bits/stdc++.h>\nusing namespace std;\nint main(){long long a,b;cin>>a>>b;cout<<a+b;}',
       'Accepted', 3,
       NOW() - INTERVAL '105 minutes'
FROM users u, contests c, problems p
WHERE u.username = 'alice_dev'
  AND c.name     = 'Spring Warmup 2026'
  AND p.title    = 'Sum of Two Numbers';

-- alice: Accepted on problem B  (submitted 75 min after contest start → ~45 min ago)
INSERT INTO submissions (user_id, contest_id, problem_id, language, code, verdict, execution_time_ms, submitted_at)
SELECT u.id, c.id, p.id,
       'C++', '#include<bits/stdc++.h>\nusing namespace std;\nint main(){string s;cin>>s;reverse(s.begin(),s.end());cout<<s;}',
       'Accepted', 2,
       NOW() - INTERVAL '45 minutes'
FROM users u, contests c, problems p
WHERE u.username = 'alice_dev'
  AND c.name     = 'Spring Warmup 2026'
  AND p.title    = 'Reverse a String';

-- charlie: Wrong Answer on problem A
INSERT INTO submissions (user_id, contest_id, problem_id, language, code, verdict, execution_time_ms, submitted_at)
SELECT u.id, c.id, p.id,
       'Java', 'import java.util.Scanner;\npublic class Main{public static void main(String[] a){Scanner sc=new Scanner(System.in);System.out.println(sc.nextInt());}}',
       'Wrong Answer', NULL,
       NOW() - INTERVAL '100 minutes'
FROM users u, contests c, problems p
WHERE u.username = 'charlie_dev'
  AND c.name     = 'Spring Warmup 2026'
  AND p.title    = 'Sum of Two Numbers';

-- charlie: Time Limit Exceeded on problem A
INSERT INTO submissions (user_id, contest_id, problem_id, language, code, verdict, execution_time_ms, submitted_at)
SELECT u.id, c.id, p.id,
       'Java', 'import java.util.Scanner;\npublic class Main{public static void main(String[] a){Scanner sc=new Scanner(System.in);int x=sc.nextInt();int y=sc.nextInt();int s=0;for(int i=0;i<x;i++)s+=1;for(int i=0;i<y;i++)s+=1;System.out.println(s);}}',
       'Time Limit Exceeded', 1000,
       NOW() - INTERVAL '80 minutes'
FROM users u, contests c, problems p
WHERE u.username = 'charlie_dev'
  AND c.name     = 'Spring Warmup 2026'
  AND p.title    = 'Sum of Two Numbers';

-- charlie: Pending submission on problem B (just submitted)
INSERT INTO submissions (user_id, contest_id, problem_id, language, code, verdict, execution_time_ms, submitted_at)
SELECT u.id, c.id, p.id,
       'Java', 'import java.util.Scanner;\npublic class Main{public static void main(String[] a){Scanner sc=new Scanner(System.in);String s=sc.next();System.out.println(new StringBuilder(s).reverse());}}',
       'Pending', NULL,
       NOW() - INTERVAL '2 minutes'
FROM users u, contests c, problems p
WHERE u.username = 'charlie_dev'
  AND c.name     = 'Spring Warmup 2026'
  AND p.title    = 'Reverse a String';

-- ================================================================
-- Manually sync contest_scores for the Accepted submissions above.
-- (Normally done by submit_and_score(); required here because we
--  bypassed the procedure with direct INSERTs.)
--
-- alice: solved=2, penalty=(15 + 0) + (75 + 0) = 90
-- bob:   solved=1, penalty=(32 + 20) = 52  [32 min ≈ 120-88, 1 WA]
-- ================================================================
UPDATE contest_scores cs
SET solved = 2, penalty = 90
FROM contests c, users u
WHERE cs.contest_id = c.id
  AND cs.user_id    = u.id
  AND c.name        = 'Spring Warmup 2026'
  AND u.username    = 'alice_dev';

UPDATE contest_scores cs
SET solved = 1, penalty = 52
FROM contests c, users u
WHERE cs.contest_id = c.id
  AND cs.user_id    = u.id
  AND c.name        = 'Spring Warmup 2026'
  AND u.username    = 'bob_dev';

-- ================================================================
-- Activity records for streak testing (alice solved problems today
-- and on the previous two days).
-- ================================================================
INSERT INTO user_daily_activity (user_id, activity_date)
SELECT id, CURRENT_DATE       FROM users WHERE username = 'alice_dev' ON CONFLICT DO NOTHING;
INSERT INTO user_daily_activity (user_id, activity_date)
SELECT id, CURRENT_DATE - 1   FROM users WHERE username = 'alice_dev' ON CONFLICT DO NOTHING;
INSERT INTO user_daily_activity (user_id, activity_date)
SELECT id, CURRENT_DATE - 2   FROM users WHERE username = 'alice_dev' ON CONFLICT DO NOTHING;

-- Sync alice's streak manually (trigger won't fire on historical rows)
UPDATE users SET current_streak = 3, longest_streak = 3
WHERE username = 'alice_dev';
