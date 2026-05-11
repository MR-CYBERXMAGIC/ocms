const https = require('https');

// ─── LANGUAGE MAP ────────────────────────────────────────────────────────────
const LANGUAGE_MAP = {
  'cpp':        'cpp',
  'c':          'c',
  'python':     'python',
  'java':       'java',
  'javascript': 'nodejs',
  'kotlin':     'kotlin',
};

// Backward-compat alias used by submissionController
const LANG_MAP = LANGUAGE_MAP;

const FILE_NAME = {
  cpp:        'main.cpp',
  c:          'main.c',
  python:     'main.py',
  java:       'Main.java',
  nodejs:     'main.js',
  kotlin:     'main.kt',
};

// ─── LOW-LEVEL API CALL ──────────────────────────────────────────────────────
// Correct endpoint: api.onecompiler.com  /v1/run  (NOT onecompiler.com/api/v1/run)
function callOneCompiler(language, code, stdin, timeLimitMs) {
  return new Promise((resolve, reject) => {
    const mappedLang = LANGUAGE_MAP[language] || language;
    const fileName   = FILE_NAME[mappedLang] || 'main.txt';

    const body = JSON.stringify({
      language: mappedLang,
      stdin:    stdin,
      files:    [{ name: fileName, content: code }],
    });

    const options = {
      hostname: 'api.onecompiler.com',   // ← CORRECT host
      path:     '/v1/run',              // ← CORRECT path (no /api/ prefix)
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'X-API-Key':      process.env.ONECOMPILER_API_KEY || '',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('OneCompiler returned non-JSON: ' + data.slice(0, 200)));
        }
      });
    });

    // Total timeout = time limit + 8 s buffer
    req.setTimeout(timeLimitMs + 8000, () => {
      req.destroy();
      reject(new Error('OneCompiler request timed out'));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── RUN BUTTON (used by POST /api/run) ─────────────────────────────────────
async function runOnOneCompiler(code, language, stdin) {
  const mappedLang = LANGUAGE_MAP[language] || language;
  const fileName   = FILE_NAME[mappedLang] || 'main.txt';

  const resp = await fetch('https://api.onecompiler.com/v1/run', {   // ← CORRECT
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key':    process.env.ONECOMPILER_API_KEY || '',
    },
    body: JSON.stringify({
      language: mappedLang,
      stdin:    stdin || '',
      files:    [{ name: fileName, content: code }],
    }),
  });

  if (!resp.ok) throw new Error(`OneCompiler API returned HTTP ${resp.status}`);
  return resp.json();
}

// ─── SAFE RESULT PARSER ──────────────────────────────────────────────────────
function parseResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { verdict: 'Runtime Error', execTime: 0, stdout: '', stderr: 'Invalid API response' };
  }
  // API-level failure (bad key, quota exceeded, etc.)
  if (result.status === 'failed') {
    console.error('[JUDGE] OneCompiler API returned status=failed:', result.exception || result.stderr);
    return { verdict: 'Runtime Error', execTime: 0, stdout: '', stderr: result.exception || 'API Error' };
  }
  return {
    stdout:    (result.stdout    || '').trim(),
    stderr:    (result.stderr    || '').trim(),
    exception: (result.exception || '').trim(),
    execTime:  result.executionTime || 0,   // milliseconds
  };
}

// ─── VERDICT FOR ONE TEST CASE ───────────────────────────────────────────────
function getVerdict(parsed, expectedOutput, timeLimitMs) {
  // Already has a verdict set by parseResult (API failure)
  if (parsed.verdict) return parsed.verdict;

  // Compilation error: stderr with no stdout, contains typical compiler keywords
  if (parsed.stderr && !parsed.stdout) {
    const s = parsed.stderr.toLowerCase();
    if (
      s.includes('error:') ||
      s.includes('syntaxerror') ||
      s.includes('compilation failed') ||
      s.includes('cannot find symbol') ||
      s.includes('undefined reference')
    ) {
      return 'Compilation Error';
    }
  }

  // Runtime exception
  if (parsed.exception && parsed.exception.length > 0) return 'Runtime Error';

  // Time limit exceeded
  if (parsed.execTime > timeLimitMs) return 'Time Limit Exceeded';

  // Wrong answer
  if (parsed.stdout !== expectedOutput.trim()) return 'Wrong Answer';

  return 'Accepted';
}

// ─── MAIN JUDGING PIPELINE ───────────────────────────────────────────────────
async function judgeSubmission(pool, submissionId, problemId, code, language) {
  console.log('[JUDGE START]', { submissionId, problemId, language });
  console.log('[JUDGE API KEY]', process.env.ONECOMPILER_API_KEY ? 'SET ✓' : 'MISSING ✗');

  try {
    // 1. Mark In Progress immediately so frontend sees movement
    await pool.query(
      `UPDATE submissions SET verdict = 'In Progress' WHERE id = $1`,
      [submissionId]
    );

    // 2. Fetch time limit
    const probRes = await pool.query(
      'SELECT time_limit_ms FROM problems WHERE id = $1',
      [problemId]
    );
    const timeLimitMs = probRes.rows[0]?.time_limit_ms || 2000;

    // 3. Fetch hidden test cases; fall back to visible if none exist
    let tcRes = await pool.query(
      'SELECT id, input, expected_output FROM test_cases WHERE problem_id = $1 AND is_hidden = TRUE ORDER BY id',
      [problemId]
    );
    if (tcRes.rows.length === 0) {
      console.warn('[JUDGE] No hidden test cases for problem', problemId, '— falling back to visible');
      tcRes = await pool.query(
        'SELECT id, input, expected_output FROM test_cases WHERE problem_id = $1 ORDER BY id',
        [problemId]
      );
    }

    // 4. No test cases at all → auto-Accept (can't judge without cases)
    if (tcRes.rows.length === 0) {
      console.warn('[JUDGE] No test cases at all for problem', problemId, '— auto-Accepted');
      await pool.query(
        `UPDATE submissions SET execution_time_ms = 0 WHERE id = $1`,
        [submissionId]
      );
      await pool.query(`CALL submit_and_score($1, $2)`, [submissionId, 'Accepted']);
      return 'Accepted';
    }

    console.log('[JUDGE] Running against', tcRes.rows.length, 'test cases');

    // 5. Run in batches of 3 (stop on first non-Accepted)
    let finalVerdict = 'Accepted';
    let maxExecTime  = 0;
    const BATCH = 3;

    for (let i = 0; i < tcRes.rows.length && finalVerdict === 'Accepted'; i += BATCH) {
      const batch   = tcRes.rows.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(tc => callOneCompiler(language, code, tc.input, timeLimitMs))
      );

      for (let j = 0; j < results.length && finalVerdict === 'Accepted'; j++) {
        const res = results[j];
        const tc  = batch[j];

        if (res.status === 'rejected') {
          console.error('[JUDGE] API call rejected:', res.reason.message);
          finalVerdict = 'Runtime Error';
          break;
        }

        const parsed  = parseResult(res.value);
        const verdict = getVerdict(parsed, tc.expected_output, timeLimitMs);
        maxExecTime   = Math.max(maxExecTime, parsed.execTime || 0);

        console.log(
          `[JUDGE] TC ${i + j + 1} → ${verdict}`,
          '| stdout:', parsed.stdout.slice(0, 80),
          '| expected:', (tc.expected_output || '').trim().slice(0, 80)
        );

        if (verdict !== 'Accepted') finalVerdict = verdict;
      }
    }

    console.log('[JUDGE VERDICT]', finalVerdict, 'for submission', submissionId, '| execTime:', maxExecTime + 'ms');

    // 6. Store execution time
    await pool.query(
      `UPDATE submissions SET execution_time_ms = $1 WHERE id = $2`,
      [maxExecTime, submissionId]
    );

    // 7. submit_and_score: sets verdict + updates contest_scores (CE excluded from penalty)
    try {
      await pool.query(`CALL submit_and_score($1, $2)`, [submissionId, finalVerdict]);
      console.log('[JUDGE] submit_and_score succeeded');
    } catch (procErr) {
      console.error('[JUDGE] submit_and_score FAILED:', procErr.message, '— falling back to direct update');
      await pool.query(
        `UPDATE submissions SET verdict = $1 WHERE id = $2`,
        [finalVerdict, submissionId]
      );
    }

    return finalVerdict;

  } catch (err) {
    // SAFETY NET — always resolve to a verdict, never leave stuck at In Progress
    console.error('[JUDGE CRASH] submission', submissionId, '—', err.message);
    try {
      await pool.query(
        `UPDATE submissions SET verdict = 'Runtime Error' WHERE id = $1`,
        [submissionId]
      );
    } catch (dbErr) {
      console.error('[JUDGE DB FALLBACK FAILED]', dbErr.message);
    }
    return 'Runtime Error';
  }
}

module.exports = { runOnOneCompiler, judgeSubmission, LANGUAGE_MAP, LANG_MAP };
