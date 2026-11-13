// Apply the saved theme before first paint to avoid a light/dark flash.
// Kept as a separate file (not inline) so the Content-Security-Policy can forbid inline scripts.
try {
  var t = localStorage.getItem('vl-theme') || 'system';
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
