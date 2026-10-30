const Notification = {
  _timeout: null,

  show(message, type = 'info') {
    const el = document.getElementById('notification-toast');
    if (!el) return;

    const colors = {
      success: 'bg-fern text-white',
      error: 'bg-berry text-white',
      warning: 'bg-saffron text-ink',
      info: 'bg-ink text-paper'
    };

    el.className = 'fixed top-20 right-4 z-[100] px-5 py-3 rounded shadow-lg text-sm transition-all duration-300 ' + (colors[type] || colors.info);
    el.textContent = message;
    el.style.display = 'block';
    el.style.opacity = '1';

    if (this._timeout) clearTimeout(this._timeout);
    this._timeout = setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => { el.style.display = 'none'; }, 300);
    }, 3000);
  }
};
