function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function icon(name) {
  const paths = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    prices: '<path d="M3 18l5-6 4 3 7-9"/><path d="M3 21h18"/>',
    rides: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    records: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>',
    refresh: '<path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/>',
    warning: '<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  };
  return `<svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
}

function renderLatestGroups(groups) {
  return groups.map((group) => `<section class="latest-section" aria-labelledby="latest-${escapeHtml(group.key)}">
    <div class="latest-section-head">
      <div><h2 id="latest-${escapeHtml(group.key)}">${escapeHtml(group.title)}</h2><p>${escapeHtml(group.caption)}</p></div>
      <span>${group.items.length} 项</span>
    </div>
    <div class="latest-grid">${group.items.map((item) => `<article class="latest-card">
      <div class="latest-card-label">${escapeHtml(item.label)}</div>
      <strong>${escapeHtml(item.value)}</strong>
      <p>${escapeHtml(item.meta)}</p>
      <div class="latest-card-source"><span>${escapeHtml(item.source)}</span><time>${escapeHtml(item.updatedAt)}</time></div>
    </article>`).join("")}</div>
  </section>`).join("");
}

function renderSeatDots(plan) {
  return Array.from({ length: Math.max(1, Number(plan.sellableSeats) || 1) }, (_, index) =>
    `<span class="seat-dot${index < Number(plan.occupiedSeats) ? " occupied" : ""}"></span>`
  ).join("");
}

function renderOverviewRidePlans(plans) {
  return plans.map((plan) => `<article class="overview-ride">
    <div class="overview-ride-title">
      <strong>${escapeHtml(plan.name)}</strong>
      <span class="status-badge ${escapeHtml(plan.renewTone || "muted")}">${escapeHtml(plan.renewLabel)}</span>
    </div>
    <div class="seat-row">${renderSeatDots(plan)}<span>${escapeHtml(plan.seatLabel)}</span></div>
    <div class="overview-ride-meta"><span>${escapeHtml(plan.priceLabel)}</span><span>${escapeHtml(plan.outstandingLabel)}</span></div>
  </article>`).join("");
}

function renderOverview(overview) {
  const notice = overview.notice ? `<div class="source-notice" role="status">
    ${icon("warning")}
    <strong>${escapeHtml(overview.notice.title)}</strong>
    <span>${escapeHtml(overview.notice.detail)}</span>
  </div>` : "";

  return `<section class="dashboard-view" data-dashboard-view="overview">
    ${notice}
    <div class="latest-groups">${renderLatestGroups(overview.groups)}</div>
    <section class="dashboard-panel overview-rides">
      <div class="dashboard-panel-head">
        <div><h2>拼车账户</h2><p>续费、车位与收款统一管理</p></div>
        <span>${escapeHtml(overview.ridesLabel)}</span>
      </div>
      <div class="overview-ride-list">${renderOverviewRidePlans(overview.ridePlans)}</div>
    </section>
  </section>`;
}

function renderSourceHealth(items) {
  return `<section class="dashboard-panel source-health-panel">
    <div class="dashboard-panel-head"><div><h2>数据源状态</h2><p>抓取健康度与最近有效记录</p></div></div>
    <div class="source-health-grid">${items.map((item) => `<article class="source-health-item">
      <div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div>
      <span class="health-${escapeHtml(item.tone)}">${escapeHtml(item.status)}</span>
    </article>`).join("")}</div>
  </section>`;
}

function renderNavItem(view, label, iconName, selected = false) {
  return `<button type="button" data-dashboard-nav="${view}" aria-selected="${selected}">${icon(iconName)}<span>${label}</span></button>`;
}

const DASHBOARD_STYLES = `
  :root {
    color-scheme: light;
    --app-bg: #eef2ef;
    --app-sidebar: #102f27;
    --app-sidebar-active: #284940;
    --app-sidebar-text: #edf7f2;
    --app-sidebar-muted: #9ab0a7;
    --app-panel: #ffffff;
    --app-panel-soft: #f6f8f6;
    --app-text: #17231f;
    --app-muted: #718078;
    --app-line: #dbe4de;
    --app-accent: #218b64;
    --app-accent-soft: #def3e8;
    --app-danger: #c65350;
    --app-danger-soft: #faeceb;
    --app-warning: #9c6819;
    --app-warning-soft: #f7f1e6;
    --app-purple: #7551a6;
    --app-shadow: 0 1px 2px rgba(20, 47, 38, 0.04);
  }
  * { box-sizing: border-box; }
  html { min-width: 720px; background: var(--app-bg); }
  body { margin: 0; min-width: 720px; background: var(--app-bg); color: var(--app-text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  button, input, select { font: inherit; }
  a { color: var(--app-accent); }
  .app-icon { width: 18px; height: 18px; flex: none; }
  .dashboard-shell { display: grid; grid-template-columns: clamp(176px, 14vw, 208px) minmax(0, 1fr); min-height: 100vh; }
  .dashboard-sidebar { position: sticky; top: 0; display: flex; flex-direction: column; gap: 26px; height: 100vh; padding: 24px 14px; background: var(--app-sidebar); color: var(--app-sidebar-text); }
  .dashboard-brand { display: flex; align-items: center; gap: 10px; padding: 0 8px; }
  .dashboard-logo { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 10px; background: #49c792; color: #092018; font-weight: 800; }
  .dashboard-brand strong { display: block; font-size: 15px; }
  .dashboard-brand small { display: block; margin-top: 2px; color: var(--app-sidebar-muted); font-size: 11px; }
  .dashboard-nav { display: grid; gap: 5px; }
  .dashboard-nav button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 42px; padding: 0 11px; border: 0; border-radius: 10px; background: transparent; color: var(--app-sidebar-muted); cursor: pointer; text-align: left; }
  .dashboard-nav button:hover { color: var(--app-sidebar-text); background: rgba(255,255,255,.06); }
  .dashboard-nav button[aria-selected="true"] { color: var(--app-sidebar-text); background: var(--app-sidebar-active); }
  .sidebar-status { margin-top: auto; padding: 14px 10px 2px; border-top: 1px solid rgba(255,255,255,.12); color: var(--app-sidebar-muted); font-size: 12px; }
  .sidebar-status strong { display: block; margin-top: 6px; color: var(--app-sidebar-text); font-size: 14px; }
  .dashboard-main { min-width: 0; padding: clamp(20px, 2.2vw, 34px); }
  .dashboard-content { width: 100%; max-width: 1400px; margin: 0 auto; }
  .dashboard-topbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
  .dashboard-title h1 { margin: 0; font-size: 26px; line-height: 1.2; letter-spacing: -.025em; }
  .dashboard-title p { margin: 6px 0 0; color: var(--app-muted); font-size: 14px; }
  .dashboard-actions { display: flex; gap: 8px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 0 14px; border: 1px solid var(--app-line); border-radius: 10px; background: var(--app-panel); color: var(--app-text); text-decoration: none; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: var(--app-shadow); }
  .btn:hover { border-color: #bdcbc3; }
  .btn.primary { border-color: var(--app-accent); background: var(--app-accent); color: white; }
  .btn:disabled { opacity: .58; cursor: default; }
  .dashboard-view[hidden] { display: none !important; }
  .source-notice { display: flex; align-items: center; gap: 10px; min-height: 46px; padding: 10px 14px; border: 1px solid #ddcfb6; border-radius: 11px; background: var(--app-warning-soft); font-size: 14px; }
  .source-notice .app-icon { color: var(--app-warning); }
  .source-notice span { color: var(--app-muted); }
  .tone-positive { color: var(--app-accent); }
  .tone-negative { color: var(--app-danger); }
  .tone-warning { color: var(--app-warning); }
  .tone-neutral { color: var(--app-muted); }
  .dashboard-panel, .panel { border: 1px solid var(--app-line); border-radius: 14px; background: var(--app-panel); box-shadow: var(--app-shadow); overflow: hidden; }
  .dashboard-panel-head, .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 18px; border-bottom: 1px solid var(--app-line); }
  .dashboard-panel-head h2, .panel-head h2 { margin: 0; font-size: 16px; }
  .dashboard-panel-head p, .phead-meta { margin: 4px 0 0; color: var(--app-muted); font-size: 13px; }
  .latest-groups { display: grid; gap: 22px; margin-top: 16px; }
  .latest-section-head { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
  .latest-section-head h2 { margin: 0; font-size: 17px; }
  .latest-section-head p { margin: 4px 0 0; color: var(--app-muted); font-size: 13px; }
  .latest-section-head > span { color: var(--app-muted); font-size: 12px; font-weight: 700; }
  .latest-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
  .latest-card { min-width: 0; padding: 16px; border: 1px solid var(--app-line); border-radius: 13px; background: var(--app-panel); box-shadow: var(--app-shadow); }
  .latest-card-label { overflow: hidden; color: var(--app-muted); font-size: 13px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
  .latest-card > strong { display: block; margin-top: 11px; font-size: 26px; line-height: 1.1; letter-spacing: -.025em; }
  .latest-card > p { min-height: 34px; margin: 10px 0 0; color: var(--app-muted); font-size: 12px; line-height: 1.45; }
  .latest-card-source { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--app-line); color: var(--app-muted); font-size: 11px; }
  .latest-card-source time { overflow: hidden; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
  .overview-rides { margin-top: 22px; }
  .overview-ride-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .overview-ride { padding: 17px 18px; }
  .overview-ride + .overview-ride { border-left: 1px solid var(--app-line); }
  .overview-ride-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .status-badge { padding: 4px 8px; border-radius: 6px; background: var(--app-panel-soft); color: var(--app-muted); font-size: 12px; }
  .status-badge.danger { background: var(--app-danger-soft); color: var(--app-danger); }
  .status-badge.positive { background: var(--app-accent-soft); color: var(--app-accent); }
  .seat-row { display: flex; align-items: center; gap: 7px; margin-top: 18px; }
  .seat-dot { width: 11px; height: 11px; border-radius: 50%; background: var(--app-line); }
  .seat-dot.occupied { background: var(--app-accent); }
  .seat-row > span:last-child { margin-left: auto; color: var(--app-muted); font-size: 13px; }
  .overview-ride-meta { display: flex; justify-content: space-between; gap: 12px; margin-top: 14px; color: var(--app-muted); font-size: 13px; }
  .view-header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin: 2px 0 14px; }
  .view-header h2 { margin: 0; font-size: 20px; }
  .view-header p { margin: 5px 0 0; color: var(--app-muted); font-size: 13px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(205px, 1fr)); gap: 12px; margin-top: 12px; }
  .card { padding: 16px; border: 1px solid var(--app-line); border-radius: 13px; background: var(--app-panel); box-shadow: var(--app-shadow); }
  .card .label { color: var(--app-muted); font-size: 13px; font-weight: 700; }
  .card .value, .card .price { margin-top: 10px; font-size: 26px; line-height: 1.12; font-weight: 800; }
  .card .value.dual { display: grid; gap: 6px; font-size: 22px; }
  .card .sub { margin-top: 10px; color: var(--app-muted); font-size: 12px; line-height: 1.45; }
  .card .up { color: var(--app-accent); }
  .card .down { color: var(--app-danger); }
  .price-trends { margin-top: 12px; }
  .trend-tabs { display: flex; flex-wrap: nowrap; gap: 6px; padding: 10px 12px; overflow-x: auto; }
  .trend-tabs button { flex: none; min-height: 34px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; color: var(--app-muted); font-weight: 700; cursor: pointer; }
  .trend-tabs button:hover { background: var(--app-panel-soft); }
  .trend-tabs button.active { background: var(--app-accent-soft); color: var(--app-accent) !important; }
  .trend-panels { border-top: 1px solid var(--app-line); }
  .trend-panel { display: none; }
  .trend-panel.active { display: block; }
  .trend-summary, .trend-legend { display: flex; flex-wrap: wrap; gap: 14px; padding: 12px 16px 0; color: var(--app-muted); font-size: 13px; }
  .trend-summary strong { color: var(--app-text); }
  .trend-legend { font-weight: 700; }
  .trend-legend-item { display: inline-flex; align-items: center; gap: 7px; }
  .trend-swatch { width: 18px; height: 3px; border-radius: 999px; }
  .chart-wrap { padding: 12px 14px 8px; overflow-x: auto; }
  svg.trend { display: block; width: 100%; height: auto; }
  .ng-point { outline: none; }
  .ng-hit { fill: transparent; pointer-events: all; }
  .ng-point .tooltip { display: none; pointer-events: none; }
  .ng-point:hover .tooltip, .ng-point:focus .tooltip { display: block; }
  .conversion-chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .conversion-chart-grid > section + section { border-left: 1px solid var(--app-line); }
  .conversion-chart-title { margin: 0; padding: 14px 16px 0; color: var(--app-muted); font-size: 13px; }
  .turkey-tab-content { padding-bottom: 14px; }
  .turkey-cards { padding: 4px 16px 0; }
  .turkey-history { margin: 14px 16px 0; }
  .rides-summary { margin-bottom: 12px; }
  .rides-panel { margin-top: 12px; }
  .ride-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-bottom: 1px solid var(--app-line); }
  .ride-card { padding: 18px; }
  .ride-card + .ride-card { border-left: 1px solid var(--app-line); }
  .ride-card h3 { margin: 3px 0 0; font-size: 18px; }
  .ride-card > .label, .ride-metric .label { color: var(--app-muted); font-size: 12px; font-weight: 700; }
  .ride-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px 18px; margin-top: 16px; }
  .ride-metric .value { margin-top: 4px; font-size: 15px; font-weight: 700; line-height: 1.35; }
  .ride-note, .legend { color: var(--app-muted); font-size: 12px; line-height: 1.55; }
  .ride-note { margin-top: 12px; }
  .legend { padding: 14px 16px; }
  .edit-actions { display: flex; gap: 8px; flex-wrap: wrap; padding: 0 16px 14px; }
  .edit-form { display: none; padding: 0 16px 16px; }
  .edit-form.active { display: block; }
  .edit-plan { margin-top: 12px; border: 1px solid var(--app-line); border-radius: 12px; overflow: hidden; }
  .edit-plan-head { display: flex; align-items: end; gap: 10px; flex-wrap: wrap; padding: 12px; background: var(--app-panel-soft); border-bottom: 1px solid var(--app-line); }
  .edit-field { display: grid; gap: 4px; color: var(--app-muted); font-size: 12px; font-weight: 700; }
  .edit-field input, .edit-field select, .edit-table input, .edit-table select { min-height: 34px; border: 1px solid var(--app-line); border-radius: 8px; padding: 0 9px; background: white; color: var(--app-text); }
  .edit-field input { min-width: 120px; }
  .edit-field input[type="number"], .edit-table input[type="number"] { width: 88px; min-width: 88px; }
  .edit-table, .table-wrap { overflow-x: auto; }
  .edit-status { padding: 0 16px 14px; color: var(--app-muted); font-size: 13px; }
  .edit-status.error { color: var(--app-danger); }
  .records-stack { display: grid; gap: 12px; }
  .source-health-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .source-health-item { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 16px; border-right: 1px solid var(--app-line); }
  .source-health-item:last-child { border-right: 0; }
  .source-health-item strong { font-size: 14px; }
  .source-health-item p { margin: 6px 0 0; color: var(--app-muted); font-size: 12px; line-height: 1.4; }
  .health-positive, .health-warning, .health-negative { flex: none; font-size: 12px; font-weight: 700; }
  .health-positive { color: var(--app-accent); }
  .health-warning { color: var(--app-warning); }
  .health-negative { color: var(--app-danger); }
  .rates { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .rate-item { padding: 16px 18px; border-right: 1px solid var(--app-line); }
  .rate-item:last-child { border-right: 0; }
  .rate-item .label { color: var(--app-muted); font-size: 12px; font-weight: 700; }
  .rate-item .value { margin-top: 8px; font-size: 21px; font-weight: 800; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 11px 14px; border-bottom: 1px solid var(--app-line); text-align: left; white-space: nowrap; }
  th { background: var(--app-panel-soft); color: var(--app-muted); font-size: 11px; }
  tbody tr:last-child td { border-bottom: 0; }
  .empty { padding: 44px 16px; color: var(--app-muted); text-align: center; }
  .records-links { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  @media (max-width: 900px) {
    .dashboard-shell { grid-template-columns: 136px minmax(0, 1fr); }
    .dashboard-sidebar { padding: 18px 9px; }
    .dashboard-brand { padding: 0 4px; gap: 8px; }
    .dashboard-brand small { display: none; }
    .dashboard-main { padding: 16px; }
    .dashboard-panel-head, .panel-head { padding: 14px; }
    .latest-card, .overview-ride, .ride-card { padding: 14px; }
    .source-health-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .source-health-item:nth-child(2) { border-right: 0; }
    .source-health-item:nth-child(-n+2) { border-bottom: 1px solid var(--app-line); }
  }
  @media (min-width: 1280px) {
    .latest-grid { gap: 16px; }
    .overview-rides { margin-top: 24px; }
  }
`;

function clientScript(rideShareInitialPlans) {
  return `
    const dashboardCopy = {
      overview: ["最新数据", "所有关注项目的最近有效值"],
      prices: ["历史趋势", "按项目查看汇率、订阅与礼品卡历史"],
      rides: ["拼车管理", "车位、到期与收款管理"],
      records: ["历史记录", "每日记录、数据源状态与技术入口"],
    };
    const navButtons = [...document.querySelectorAll("[data-dashboard-nav]")];
    const views = [...document.querySelectorAll("[data-dashboard-view]")];
    const pageTitle = document.querySelector("[data-page-title]");
    const pageSubtitle = document.querySelector("[data-page-subtitle]");
    const activateView = (name) => {
      const viewName = dashboardCopy[name] ? name : "overview";
      navButtons.forEach((button) => button.setAttribute("aria-selected", String(button.dataset.dashboardNav === viewName)));
      views.forEach((view) => { view.hidden = view.dataset.dashboardView !== viewName; });
      if (pageTitle) pageTitle.textContent = dashboardCopy[viewName][0];
      if (pageSubtitle) pageSubtitle.textContent = dashboardCopy[viewName][1];
    };
    navButtons.forEach((button) => button.addEventListener("click", () => {
      activateView(button.dataset.dashboardNav);
      history.replaceState(null, "", "#" + button.dataset.dashboardNav);
    }));

    document.querySelectorAll("[data-trend-tabs]").forEach((tabs) => {
      const buttons = [...tabs.querySelectorAll("[data-trend-tab]")];
      const panelRoot = tabs.nextElementSibling;
      const panels = panelRoot ? [...panelRoot.querySelectorAll("[data-trend-panel]")] : [];
      const activateTab = (button) => {
        buttons.forEach((item) => {
          const active = item === button;
          item.classList.toggle("active", active);
          item.setAttribute("aria-selected", String(active));
        });
        panels.forEach((panel) => panel.classList.toggle("active", panel.id === button.getAttribute("aria-controls")));
      };
      buttons.forEach((button) => button.addEventListener("click", () => activateTab(button)));
      const requestedKey = window.location.hash.slice(1);
      const requestedButton = buttons.find((button) => button.dataset.trendKey === requestedKey);
      if (requestedButton) {
        activateView("prices");
        activateTab(requestedButton);
      }
    });

    const initialHash = window.location.hash.slice(1);
    if (dashboardCopy[initialHash]) activateView(initialHash);

    const rideShareInitialPlans = ${scriptJson(rideShareInitialPlans)};
    const rideShareForm = document.querySelector("[data-rideshare-form]");
    const rideShareStatus = document.querySelector("[data-rideshare-status]");
    const rideShareEditBtn = document.querySelector("[data-rideshare-edit]");
    const rideShareSaveBtn = document.querySelector("[data-rideshare-save]");
    const rideShareCancelBtn = document.querySelector("[data-rideshare-cancel]");
    const setRideShareStatus = (message, isError = false) => {
      if (!rideShareStatus) return;
      rideShareStatus.textContent = message || "";
      rideShareStatus.classList.toggle("error", Boolean(isError));
    };
    const resetRideShareForm = () => {
      rideShareInitialPlans.forEach((plan, planIndex) => {
        const root = document.querySelector('[data-plan-index="' + planIndex + '"]');
        root?.querySelectorAll("[data-plan-field]").forEach((input) => {
          input.value = (plan[input.dataset.planField] ?? "").toString();
        });
        plan.seats.forEach((seat, seatIndex) => {
          const row = root?.querySelector('[data-seat-index="' + seatIndex + '"]');
          row?.querySelectorAll("[data-seat-field]").forEach((input) => {
            const field = input.dataset.seatField;
            input.value = field === "chargeCny" || field === "paidAmountCny"
              ? (Number.isFinite(seat[field]) ? String(seat[field]) : "")
              : (seat[field] ?? "").toString();
          });
        });
      });
    };
    rideShareEditBtn?.addEventListener("click", () => {
      rideShareForm?.classList.add("active");
      rideShareEditBtn.disabled = true;
      setRideShareStatus("修改后点击保存。首次保存需要输入 RUN_TOKEN。");
    });
    rideShareCancelBtn?.addEventListener("click", () => {
      resetRideShareForm();
      rideShareForm?.classList.remove("active");
      if (rideShareEditBtn) rideShareEditBtn.disabled = false;
      setRideShareStatus("");
    });
    const readMoneyInput = (input) => {
      const value = input?.value?.trim();
      if (!value) return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    const collectRideSharePlans = () => rideShareInitialPlans.map((plan, planIndex) => {
      const root = document.querySelector('[data-plan-index="' + planIndex + '"]');
      const nextPlan = { ...plan };
      root?.querySelectorAll("[data-plan-field]").forEach((input) => {
        nextPlan[input.dataset.planField] = input.value.trim();
      });
      nextPlan.seats = plan.seats.map((seat, seatIndex) => {
        const row = root?.querySelector('[data-seat-index="' + seatIndex + '"]');
        const nextSeat = { ...seat };
        row?.querySelectorAll("[data-seat-field]").forEach((input) => {
          const field = input.dataset.seatField;
          nextSeat[field] = field === "chargeCny" || field === "paidAmountCny" ? readMoneyInput(input) : input.value.trim();
        });
        return nextSeat;
      });
      return nextPlan;
    });
    rideShareSaveBtn?.addEventListener("click", async () => {
      let token = localStorage.getItem("ng_run_token") || "";
      if (!token) {
        token = (window.prompt("请输入 RUN_TOKEN（用于保存拼车信息）") || "").trim();
        if (!token) return;
        localStorage.setItem("ng_run_token", token);
      }
      const original = rideShareSaveBtn.textContent;
      rideShareSaveBtn.disabled = true;
      rideShareSaveBtn.textContent = "保存中…";
      setRideShareStatus("保存中…");
      try {
        const res = await fetch("/api/rideshare?token=" + encodeURIComponent(token), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plans: collectRideSharePlans() }),
        });
        if (res.status === 403) {
          localStorage.removeItem("ng_run_token");
          setRideShareStatus("RUN_TOKEN 无效，请重新保存并输入。", true);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          setRideShareStatus("保存失败：" + (data.error || ("HTTP " + res.status)), true);
          return;
        }
        setRideShareStatus("保存成功，正在刷新…");
        window.location.reload();
      } catch (error) {
        setRideShareStatus("请求出错：" + error.message, true);
      } finally {
        rideShareSaveBtn.disabled = false;
        rideShareSaveBtn.textContent = original;
      }
    });

    const scrapeBtn = document.querySelector("[data-scrape]");
    scrapeBtn?.addEventListener("click", async () => {
      let token = localStorage.getItem("ng_run_token") || "";
      if (!token) {
        token = (window.prompt("请输入 RUN_TOKEN（用于授权写入数据）") || "").trim();
        if (!token) return;
        localStorage.setItem("ng_run_token", token);
      }
      const original = scrapeBtn.textContent;
      scrapeBtn.disabled = true;
      scrapeBtn.textContent = "抓取中…";
      try {
        const res = await fetch("/run?token=" + encodeURIComponent(token), { method: "GET" });
        if (res.status === 403) {
          localStorage.removeItem("ng_run_token");
          window.alert("RUN_TOKEN 无效，请重新输入");
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (data && data.nigeria && data.nigeria.ok) {
          window.location.reload();
          return;
        }
        const reason = (data && data.errors && JSON.stringify(data.errors)) || (data && data.error) || ("HTTP " + res.status);
        window.alert("抓取失败：" + reason);
      } catch (error) {
        window.alert("请求出错：" + error.message);
      } finally {
        scrapeBtn.disabled = false;
        scrapeBtn.textContent = original;
      }
    });
  `;
}

export function renderDashboardPage(model) {
  const healthyCount = model.sourceHealth.filter((item) => item.tone === "positive").length;
  const overview = renderOverview(model.overview);
  const prices = `<section class="dashboard-view" data-dashboard-view="prices" hidden>
    <div class="view-header"><div><h2>关注项目历史</h2><p>切换分组查看每日走势、累计变化与历史明细</p></div></div>
    <section class="dashboard-panel price-trends">${model.trendsHtml}</section>
  </section>`;
  const rides = `<section class="dashboard-view" data-dashboard-view="rides" hidden>
    <div class="view-header"><div><h2>拼车账户</h2><p>成本、车位、到期与收款集中管理</p></div></div>
    <div class="cards rides-summary">${model.ridesSummaryHtml}</div>
    <section class="dashboard-panel rides-panel">${model.ridesHtml}</section>
  </section>`;
  const records = `<section class="dashboard-view" data-dashboard-view="records" hidden>
    <div class="view-header">
      <div><h2>记录与来源</h2><p>默认收起技术细节，只在这里集中查看</p></div>
      <div class="records-links"><a class="btn" href="/api/nigeria">价格 JSON</a><a class="btn" href="/api/history">礼品卡 JSON</a><a class="btn" href="/api/rideshare">拼车 JSON</a></div>
    </div>
    <div class="records-stack">${renderSourceHealth(model.sourceHealth)}${model.ratesHtml}${model.historyHtml}</div>
  </section>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>跨区账本</title>
  <style>${DASHBOARD_STYLES}</style>
</head>
<body>
  <div class="dashboard-shell">
    <aside class="dashboard-sidebar">
      <div class="dashboard-brand"><span class="dashboard-logo">R</span><span><strong>跨区账本</strong><small>Region Ledger</small></span></div>
      <nav class="dashboard-nav" aria-label="主导航">
        ${renderNavItem("overview", "首页", "overview", true)}
        ${renderNavItem("prices", "历史趋势", "prices")}
        ${renderNavItem("rides", "拼车管理", "rides")}
        ${renderNavItem("records", "历史记录", "records")}
      </nav>
      <div class="sidebar-status">数据源状态<strong>${healthyCount} / ${model.sourceHealth.length} 正常</strong></div>
    </aside>
    <main class="dashboard-main">
      <div class="dashboard-content">
        <header class="dashboard-topbar">
          <div class="dashboard-title"><h1 data-page-title>最新数据</h1><p><span data-page-subtitle>所有关注项目的最近有效值</span> · ${escapeHtml(model.updatedAt)} 更新</p></div>
          <div class="dashboard-actions"><button class="btn" type="button" data-scrape>${icon("refresh")}刷新数据</button></div>
        </header>
        ${overview}${prices}${rides}${records}
      </div>
    </main>
  </div>
  <script>${clientScript(model.rideShareInitialPlans)}</script>
</body>
</html>`;
}
