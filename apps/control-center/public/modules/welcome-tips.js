/**
 * Welcome tip catalog (Codeg WelcomeTip pattern, 514 multi-CLI governance copy).
 */

export const WELCOME_TIPS = Object.freeze([
  { html: "输入 <kbd>@</kbd> 点名成员，把任务直接路由给对应原生 CLI" },
  { html: "<kbd>Ctrl</kbd>+<kbd>K</kbd> 打开命令面板：跳转视图、套用模板、管理团队" },
  { html: "输入 <kbd>/</kbd> 切换 Plan / Review / Build——权限模式写进本 run" },
  { html: "点星图成员即设起始；Leader 负责收敛，证据进 Mission Dock" },
  { html: "审批通过 = 签发能力租约：有 TTL、作用域与可吊销痕迹" },
  { html: "Mission「证据」不是聊天摘要，是 Task · Attempt · Artifact 关系图" },
  { html: "Build 写在隔离工作树；终态结算卡可 diff，不会静默 merge 主分支" },
  { html: "社会编排支持 <code>[[msg:成员]]</code> 可寻址路由与乒乓熔断" },
]);

export function pickWelcomeTip(random = Math.random) {
  const index = Math.floor(Number(random()) * WELCOME_TIPS.length) % WELCOME_TIPS.length;
  return WELCOME_TIPS[index] || WELCOME_TIPS[0];
}

export function welcomeTipMarkup({ iconHtml = "", random = Math.random } = {}) {
  const tip = pickWelcomeTip(random);
  return `
    <div class="welcome-tip" role="note">
      <span class="welcome-tip-icon" aria-hidden="true">${iconHtml}</span>
      <p>${tip.html}</p>
    </div>`;
}
