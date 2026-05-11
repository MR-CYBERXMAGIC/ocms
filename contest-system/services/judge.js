const https = require('https');

const LANGUAGE_MAP = {
  'cpp':        'cpp',
  'c':          'c',
  'python':     'python',
  'java':       'java',
  'javascript': 'nodejs',
  'kotlin':     'kotlin',
};

// Backward-compat alias
const LANG_MAP = LANGUAGE_MAP;

const FILE_EXT = {
  cpp: 'cpp', c: 'c', python: 'py', java: 'java', javascript: 'js', kotlin: 'kt',
};

// Low-level call to OneCompiler — used by judgeSubmission
function callOneCompiler(language, code, input, timeLimitMs) {
  return new Promise((resolve, reject) => {
    const lang = LANGUAGE_MAP[language] || language;
    const ext  = FILE_EXT[language] || 'txt';
    const body = JSON.stringify({
      language: lang,
      stdin:    input,
      files:    [{ name: `solution.${ext}`, content: code }],
    });
    const options = {
      hostname: 'onecompiler.com',
      path:     '/api/v1/run',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'X-API-Key':      process.env.ONECOMPILER_API_KEY || '',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from OneCompiler')); }
      });
    });
    req.setTimeout(timeLimitMs + 5000, () => { req.destroy(); reject(new Error('API timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// fetch-based wrapper used by /api/run (run button on problem page)
async function runOnOneCompiler(code, language, stdin) {
  const lang = LANGUAGE_MAP[language] || language.toLowerCase();
  const ext  = FILE_EXT[lang] || 'txt';
  const resp = await fetch('https://onecompiler.com/api/v1/run', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key':    process.env.ONECOMPILER_API_KEY || '',
    },
    body: JSON.stringify({
      language: lang,
      stdin:    stdin || '',
      files:    [{ name: `main.${ext}`, content: code }],
    }),
  });
  if (!resp.ok) throw new Error(`OneCompiler API returned ${resp.status}`);
  return resp.json();
}

function isCompileError(result) {
  if (!result) return false;
  const stderr    = (result.stderr || result.exception || '').toLowerCase();
  const hasStdout = !!(result.stdout && result.stdout.trim());
  if (!stderr) return false;
  if (stderr.includes('compilation failed'))                               return true;
  if (stderr.includes('error:') && !hasStdout)                            return true;
  if (stderr.includes('syntaxerror'))                                      return true;
  if (stderr.includes('compile') && !stderr.includes('nameerror: name'))  return true;
  if (result.status && result.status.code !== 0 && !hasStdout)            return true;
  return false;
}

// Full judging pipeline with ICPC rules.
// Updates verdict in DB and calls submit_and_score() stored proc.
// Returns the final verdict string.
async function judgeSubmission(pool, submissionId, problemId, code, language) {
  try {
    const probRes = await pool.query(
      'SELECT time_limit_ms FROM problems WHERE id = $1',
      [problemId]
    );
    const timeLimitMs = probRes.rows[0]?.time_limit_ms || 2000;

    const tcRes = await pool.query(
      `SELECT id, input, expected_output
       FROM test_cases WHERE problem_id = $1 AND is_hidden = TRUE ORDER BY id`,
      [problemId]
    );
    const testCases = tcRes.rows;

    if (testCases.length === 0) {
      await pool.query(
        `UPDATE submissions SET execution_time_ms = 0 WHERE id = $1`,
        [submissionId]
      );
      await pool.query(`CALL submit_and_score($1, $2)`, [submissionId, 'Accepted']);
      return 'Accepted';
    }

    await pool.query(
      `UPDATE submissions SET verdict = 'In Progress' WHERE id = $1`,
      [submissionId]
    );

    let finalVerdict = 'Accepted';
    let maxExecTime  = 0;
    const BATCH_SIZE = 3;

    for (let i = 0; i < testCases.length; i += BATCH_SIZE) {
      if (finalVerdict !== 'Accepted') break;

      const batch   = testCases.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(tc => callOneCompiler(language, code, tc.input, timeLimitMs))
      );

      for (let j = 0; j < results.length; j++) {
        if (finalVerdict !== 'Accepted') break;
        const res = results[j];
        const tc  = batch[j];

        if (res.status === 'rejected') { finalVerdict = 'Runtime Error'; break; }

        const r = res.value;

        if (isCompileError(r)) { finalVerdict = 'Compilation Error'; break; }

        const execMs = r.executionTime || (r.status && r.status.executionTime) || 0;
        maxExecTime  = Math.max(maxExecTime, execMs);

        if (execMs > timeLimitMs) { finalVerdict = 'Time Limit Exceeded'; break; }

        if (r.stderr && r.stderr.trim() && !isCompileError(r)) {
          finalVerdict = 'Runtime Error'; break;
        }

        const actual   = (r.stdout || '').trim();
        const expected = tc.expected_output.trim();
        if (actual !== expected) { finalVerdict = 'Wrong Answer'; break; }
      }
    }

    await pool.query(
      `UPDATE submissions SET execution_time_ms = $1 WHERE id = $2`,
      [maxExecTime, submissionId]
    );

    // submit_and_score handles verdict update + ICPC scoring (CE excluded from penalty)
    await pool.query(`CALL submit_and_score($1, $2)`, [submissionId, finalVerdict]);
    return finalVerdict;

  } catch (err) {
    console.error('[Judge] judgeSubmission error:', err.message);
    await pool.query(
      `UPDATE submissions SET verdict = 'Runtime Error' WHERE id = $1`,
      [submissionId]
    ).catch(() => {});
    return 'Runtime Error';
  }
}

module.exports = { runOnOneCompiler, judgeSubmission, LANGUAGE_MAP, LANG_MAP };
