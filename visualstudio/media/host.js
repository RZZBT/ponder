// Bridge between the Visual Studio tool window (WebView2) and the engine.
window.__ponderPost = function (s) { window.chrome.webview.postMessage(s); };
window.chrome.webview.addEventListener('message', function (e) {
  var m = e.data;
  if (!m || m.type !== 'start' || typeof m.text !== 'string' || typeof m.id !== 'string') return;
  Ponder.start(m.text, m.id, { theme: m.theme === 'light' ? 'light' : 'dark', hostControls: false });
});
window.chrome.webview.postMessage(JSON.stringify({ type: 'loaded' }));
