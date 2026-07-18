// 主题首帧引导：在样式表之前同步执行，避免暗色用户看到白屏闪烁。
// CSP script-src 'self' 禁内联脚本，所以独立成文件；app.js 里的 initializeTheme 负责后续切换。
(function () {
  var theme = "light";
  try {
    var stored = localStorage.getItem("514cc-control-theme");
    if (stored === "light" || stored === "dark") theme = stored;
    else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";
  } catch (error) {
    /* localStorage 不可用（隐私模式等）时保持亮色 */
  }
  document.documentElement.dataset.theme = theme;
})();
