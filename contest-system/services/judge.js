const pool = require('../db/pool');

const ONECOMPILER_URL = 'https://onecompiler.com/api/v1/run';

const LANG_MAP = {
  'C++17':    'cpp',
  'Python 3': 'python',
  'Java':     'java',
  'C':        'c',
};

const FILE_EXT = { cpp: 'cpp', python: 'py', java: 'java', c: 'c' };

async function runOnOneCompiler(code, language, stdin) {
  const lang    = LANG_MAP[language] || language.toLowerCase();
  const ext     = FILE_EXT[lang] || 'txt';
  const apiKey  = process.env.ONECOMPILER_API_KEY || '';

  const resp = await fetch(ONECOMPILER_URL, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key':    apiKey,
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

async function judgeCustomProblem(code, language, problemId) {
  const { rows } = await pool.query(
    `SELECT tc.input, tc.expected_output, p.time_limit_ms
     FROM test_cases tc
     JOIN problems p ON p.id = tc.problem_id
     WHERE tc.problem_id = $1 AND tc.is_hidden = TRUE
     ORDER BY tc.id ASC`,
    [problemId]
  );

  if (!rows.length) return { verdict: 'Accepted', execution_time_ms: 0 };

  const timeLimitMs = rows[0].time_limit_ms;
  let maxExecTime = 0;

  const BATCH = 3;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    const results = await Promise.all(
      batch.map(async (tc) => {
        try {
          return { tc, result: await runOnOneCompiler(code, language, tc.input) };
        } catch (err) {
          console.error('[Judge] OneCompiler error:', err.message);
          return { tc, result: null };
        }
      })
    );

    for (const { tc, result } of results) {
      if (!result) return { verdict: 'Runtime Error', execution_time_ms: maxExecTime };

      const execTime = result.executionTime || 0;
      maxExecTime = Math.max(maxExecTime, execTime);

      const stdout = (result.stdout || '').trim();
      const stderr = (result.stderr || '').trim();

      if (!stdout && !stderr)          return { verdict: 'Runtime Error',       execution_time_ms: maxExecTime };
      if (stderr)                      return { verdict: 'Runtime Error',       execution_time_ms: maxExecTime };
      if (execTime > timeLimitMs)      return { verdict: 'Time Limit Exceeded', execution_time_ms: maxExecTime };
      if (stdout !== tc.expected_output.trim()) return { verdict: 'Wrong Answer', execution_time_ms: maxExecTime };
    }
  }

  return { verdict: 'Accepted', execution_time_ms: maxExecTime };
}

async function judgeExternalProblem(code, language, sourceUrl, platform) {
  console.log(`[Judge] External problem — ${platform}: ${sourceUrl} — manual judging required`);
  return { verdict: 'Pending', execution_time_ms: null };
}

module.exports = { runOnOneCompiler, judgeCustomProblem, judgeExternalProblem, LANG_MAP };
