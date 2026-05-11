// TOAST NOTIFICATION SYSTEM
// Usage: showToast('message', 'success' | 'error' | 'warning' | 'info')

(function() {
  let container = null;

  function getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      `;
      document.body.appendChild(container);
    }
    return container;
  }

  const COLORS = {
    success: { bg: '#d1fae5', border: '#10b981', text: '#065f46', icon: '✓' },
    error:   { bg: '#fee2e2', border: '#ef4444', text: '#991b1b', icon: '✕' },
    warning: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', icon: '⚠' },
    info:    { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af', icon: 'ℹ' }
  };

  function playSound() {
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    } catch(e) { /* silent fail if audio blocked */ }
  }

  window.showToast = function(message, type = 'success') {
    const c     = COLORS[type] || COLORS.info;
    const toast = document.createElement('div');
    toast.style.cssText = `
      background: ${c.bg};
      border: 1px solid ${c.border};
      color: ${c.text};
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      min-width: 260px;
      max-width: 380px;
      display: flex;
      align-items: center;
      gap: 10px;
      pointer-events: all;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      transform: translateX(120%);
      transition: transform 0.3s ease;
    `;
    toast.innerHTML = `<span style="font-size:16px">${c.icon}</span><span>${message}</span>`;
    toast.onclick = () => removeToast(toast);

    getContainer().appendChild(toast);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.transform = 'translateX(0)';
      });
    });

    if (type === 'success') playSound();

    setTimeout(() => removeToast(toast), 4000);
  };

  function removeToast(toast) {
    toast.style.transform = 'translateX(120%)';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }
})();
