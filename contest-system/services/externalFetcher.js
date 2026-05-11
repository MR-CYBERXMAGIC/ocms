const https = require('https');

function fetchHTML(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchHTML(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', c => { data += c; if (data.length > 600000) req.destroy(); });
      res.on('end', () => resolve(data));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}

function extractSection(html, ...selectors) {
  for (const sel of selectors) {
    const m = html.match(sel);
    if (m && m[1] && m[1].trim()) return m[1].trim();
  }
  return '';
}

async function fetchCSES(url) {
  const html = await fetchHTML(url);
  const statement = extractSection(html,
    /<div class="md-content">([\s\S]*?)<\/div>/,
    /<div class="content">([\s\S]*?)<\/div>/
  );
  const pres = [...html.matchAll(/<pre>([\s\S]*?)<\/pre>/g)].map(m => stripTags(m[1]));
  const sampleCases = [];
  for (let i = 0; i < pres.length - 1; i += 2) {
    sampleCases.push({ input: pres[i], output: pres[i + 1] });
  }
  const timeMatch  = html.match(/Time limit:\s*(\d+)\s*s/);
  const memMatch   = html.match(/Memory limit:\s*(\d+)\s*MB/);
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);

  return {
    title:            titleMatch ? titleMatch[1].trim() : '',
    statement:        statement || '',
    input_format:     '',
    output_format:    '',
    constraints_text: `Time: ${timeMatch ? timeMatch[1] : 1}s, Memory: ${memMatch ? memMatch[1] : 256}MB`,
    time_limit_ms:    timeMatch ? parseInt(timeMatch[1]) * 1000 : 1000,
    memory_limit_mb:  memMatch  ? parseInt(memMatch[1])  : 256,
    sample_cases:     sampleCases,
  };
}

async function fetchCodeChef(url) {
  const html = await fetchHTML(url);
  const statement = extractSection(html,
    /<div[^>]*id="problem-statement"[^>]*>([\s\S]*?)<\/div>/,
    /<div[^>]*class="[^"]*problem-statement[^"]*"[^>]*>([\s\S]*?)<\/div>/
  );
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const timeMatch  = html.match(/(\d+(?:\.\d+)?)\s*sec/i);
  const memMatch   = html.match(/(\d+)\s*MB/i);

  const inputs  = [...html.matchAll(/<div[^>]*class="[^"]*sample[^"]*input[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map(m => stripTags(m[1]));
  const outputs = [...html.matchAll(/<div[^>]*class="[^"]*sample[^"]*output[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map(m => stripTags(m[1]));
  const sampleCases = inputs.map((inp, i) => ({ input: inp, output: outputs[i] || '' }));

  return {
    title:            titleMatch ? titleMatch[1].trim() : '',
    statement:        statement || '',
    input_format:     '',
    output_format:    '',
    constraints_text: `Time: ${timeMatch ? timeMatch[1] : 1}s, Memory: ${memMatch ? memMatch[1] : 256}MB`,
    time_limit_ms:    timeMatch ? parseFloat(timeMatch[1]) * 1000 : 1000,
    memory_limit_mb:  memMatch  ? parseInt(memMatch[1]) : 256,
    sample_cases:     sampleCases,
  };
}

async function fetchHackerRank(url) {
  const html = await fetchHTML(url);
  const statement = extractSection(html, /<div[^>]*class="[^"]*challenge-body[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  const inputFmt  = extractSection(html, /<div[^>]*class="[^"]*challenge-input-format[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  const outputFmt = extractSection(html, /<div[^>]*class="[^"]*challenge-output-format[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);

  const sampleInputs  = [...html.matchAll(/class="[^"]*sample-input[^"]*"[^>]*>([\s\S]*?)<\/pre>/g)].map(m => stripTags(m[1]));
  const sampleOutputs = [...html.matchAll(/class="[^"]*sample-output[^"]*"[^>]*>([\s\S]*?)<\/pre>/g)].map(m => stripTags(m[1]));
  const sampleCases   = sampleInputs.map((inp, i) => ({ input: inp, output: sampleOutputs[i] || '' }));

  return {
    title:            titleMatch ? titleMatch[1].trim() : '',
    statement:        statement || '',
    input_format:     inputFmt  || '',
    output_format:    outputFmt || '',
    constraints_text: '',
    time_limit_ms:    2000,
    memory_limit_mb:  256,
    sample_cases:     sampleCases,
  };
}

async function fetchUSACO(url) {
  const html = await fetchHTML(url);
  const statement  = extractSection(html, /<div[^>]*id="probtext-text"[^>]*>([\s\S]*?)<\/div>/);
  const titleMatch = html.match(/<h2>([^<]+)<\/h2>/);
  const timeMatch  = html.match(/(\d+)\s*s(?:ec)?(?:ond)?/i);
  const memMatch   = html.match(/(\d+)\s*MB/i);

  const pres = [...html.matchAll(/<pre>([\s\S]*?)<\/pre>/g)].map(m => stripTags(m[1]));
  const sampleCases = [];
  for (let i = 0; i < pres.length - 1; i += 2) {
    sampleCases.push({ input: pres[i], output: pres[i + 1] });
  }

  return {
    title:            titleMatch ? titleMatch[1].trim() : '',
    statement:        statement || '',
    input_format:     '',
    output_format:    '',
    constraints_text: `Time: ${timeMatch ? timeMatch[1] : 4}s, Memory: ${memMatch ? memMatch[1] : 256}MB`,
    time_limit_ms:    timeMatch ? parseInt(timeMatch[1]) * 1000 : 4000,
    memory_limit_mb:  memMatch  ? parseInt(memMatch[1])  : 256,
    sample_cases:     sampleCases,
  };
}

async function fetchFullProblem(platform, url) {
  try {
    switch (platform) {
      case 'CSES':       return await fetchCSES(url);
      case 'CodeChef':   return await fetchCodeChef(url);
      case 'HackerRank': return await fetchHackerRank(url);
      case 'USACO':      return await fetchUSACO(url);
      default:           throw new Error('Unknown platform');
    }
  } catch (err) {
    return { fetch_failed: true, error: err.message, sample_cases: [] };
  }
}

module.exports = { fetchFullProblem };
