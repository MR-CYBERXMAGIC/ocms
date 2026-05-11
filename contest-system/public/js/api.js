// Shared API helpers — included on every page.

async function apiFetch(endpoint, options = {}) {
  const config = {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  if (options.body && typeof options.body === 'object') {
    config.body = JSON.stringify(options.body);
  }

  const res  = await fetch('/api' + endpoint, config);

  if (res.status === 401) {
    window.location.href = '/login.html';
    return null;
  }

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

// Human-readable relative time.
function timeAgo(iso) {
  if (!iso) return '—';
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs <  5)       return 'just now';
  if (secs <  60)      return `${secs}s ago`;
  if (secs <  3600)    return `${Math.floor(secs / 60)}m ago`;
  if (secs <  86400)   return `${Math.floor(secs / 3600)}h ago`;
  if (secs <  2592000) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Coloured verdict badge HTML.
function verdictBadge(verdict) {
  const cls = {
    'Accepted':            'badge-ac',
    'Wrong Answer':        'badge-wa',
    'Time Limit Exceeded': 'badge-tle',
    'Runtime Error':       'badge-re',
    'Compilation Error':   'badge-ce',
    'Pending':             'badge-pending',
    'In Progress':         'badge-progress',
  }[verdict] || 'badge-ce';
  return `<span class="badge ${cls}">${escHtml(verdict)}</span>`;
}

// Online / offline indicator HTML.
function statusBadge(isOnline) {
  if (isOnline) {
    return '<span style="display:inline-flex;align-items:center;gap:5px;">' +
           '<span style="width:8px;height:8px;border-radius:50%;background:var(--green);' +
           'display:inline-block;animation:onlinePulse 2s ease-in-out infinite;"></span>' +
           '<span class="badge badge-online">Online</span></span>';
  }
  return '<span class="badge badge-offline">Offline</span>';
}

// Escape HTML special characters to prevent XSS.
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}
