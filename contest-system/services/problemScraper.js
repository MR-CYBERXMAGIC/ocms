const https = require('https');
const http  = require('http');

const PLATFORM_PATTERNS = {
  'CSES':       /cses\.fi\/problemset\/task\/(\d+)/,
  'CodeChef':   /codechef\.com\/problems\/([A-Z0-9a-z]+)/,
  'HackerRank': /hackerrank\.com\/challenges\/([a-z0-9\-]+)/,
  'USACO':      /usaco\.org\/index\.php.*prob=([a-z0-9_]+)/,
};

function detectPlatform(url) {
  for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    const match = url.match(pattern);
    if (match) return { platform, problemId: match[1] };
  }
  return null;
}

function fetchPage(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 404) return reject(new Error('Page not found (404)'));
      if (res.statusCode >= 400)  return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        if (data.length > 500000) req.destroy();
      });
      res.on('end', () => resolve(data));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
  });
}

function extractTitle(html, platform) {
  const patterns = {
    'CSES':       [/<h1[^>]*>([^<]+)<\/h1>/, /<title>([^<|]+)/],
    'CodeChef':   [/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h1>/, /<title>([^<|]+)/],
    'HackerRank': [/<h1[^>]*>([^<]+)<\/h1>/, /<title>([^<|]+)/],
    'USACO':      [/<h2>([^<]+)<\/h2>/, /<title>([^<]+)<\/title>/],
  };
  const tries = patterns[platform] || [/<title>([^<]+)<\/title>/];
  for (const pattern of tries) {
    const m = html.match(pattern);
    if (m && m[1].trim()) return m[1].trim().replace(/\s+/g, ' ');
  }
  return null;
}

async function validateAndFetchProblem(url) {
  const detected = detectPlatform(url);
  if (!detected) {
    return {
      valid: false,
      error: 'URL does not match CSES, CodeChef, HackerRank, or USACO. Check the link.',
    };
  }
  try {
    const html  = await fetchPage(url);
    const title = extractTitle(html, detected.platform) || `Problem ${detected.problemId}`;
    return { valid: true, platform: detected.platform, problemId: detected.problemId, title };
  } catch (err) {
    return { valid: false, error: `Could not reach problem URL: ${err.message}` };
  }
}

module.exports = { validateAndFetchProblem, detectPlatform };
