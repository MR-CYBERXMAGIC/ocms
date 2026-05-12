let _sseSource   = null;
let _sseContestId = null;
let _sseUserId    = null;

function setSSEUserId(id) {
  _sseUserId = id ? Number(id) : null;
}

function initSSE(contestId) {
  if (_sseSource) return;
  _sseContestId = contestId;

  function connect() {
    _sseSource = new EventSource(`/api/contests/${contestId}/events`);

    _sseSource.addEventListener('problem_added', e => {
      const d = JSON.parse(e.data);
      if (typeof showToast === 'function') showToast(`Problem ${d.label} added: ${d.title || ''}`, 'info');
      if (typeof onProblemAdded === 'function') onProblemAdded(d);
    });

    _sseSource.addEventListener('problem_deleted', e => {
      const d = JSON.parse(e.data);
      if (typeof showToast === 'function') showToast(`Problem ${d.label} has been removed`, 'warning');
      if (typeof onProblemDeleted === 'function') onProblemDeleted(d);
    });

    _sseSource.addEventListener('contest_updated', e => {
      const d = JSON.parse(e.data);
      if (typeof showToast === 'function') showToast(d.message || 'Contest updated', 'info');
      if (typeof onContestUpdated === 'function') onContestUpdated(d);
    });

    _sseSource.addEventListener('contest_ended', e => {
      const d = JSON.parse(e.data);
      if (typeof showToast === 'function') showToast(d.message || 'Contest has ended', 'warning');
      setTimeout(() => location.reload(), 2500);
    });

    _sseSource.addEventListener('you_are_blocked', e => {
      const d = JSON.parse(e.data);
      // Ignore events not targeting this user
      if (_sseUserId && d.userId && Number(d.userId) !== _sseUserId) return;
      if (typeof showToast === 'function') showToast(d.message || 'You have been removed from this contest', 'error');
      setTimeout(() => { location.href = `/contest.html?id=${_sseContestId}`; }, 2500);
    });

    _sseSource.addEventListener('contest_warning', e => {
      const d = JSON.parse(e.data);
      if (typeof showToast === 'function') showToast(d.message || '5 minutes remaining!', 'warning');
    });

    _sseSource.addEventListener('duration_changed', e => {
      const d = JSON.parse(e.data);
      if (typeof showToast === 'function') showToast(`⏱ ${d.message}`, 'info');
      if (typeof updateTimerEndTime === 'function') updateTimerEndTime(d.new_end_time);
    });

    _sseSource.onerror = () => {
      _sseSource.close();
      _sseSource = null;
      // Reconnect after 5 seconds
      setTimeout(connect, 5000);
    };
  }

  connect();
}
