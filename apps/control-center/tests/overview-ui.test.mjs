/**
 * 系统总览：调用分析落在 overview，不造演示数字，代理与任务分账。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const publicRoot = resolve(import.meta.dirname, "../public");

test("overview owns usage deck, health pills and honest source split", async () => {
  const [index, app, api, css] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
    readFile(resolve(publicRoot, "api.js"), "utf8"),
    readFile(resolve(publicRoot, "forge/overview.css"), "utf8"),
  ]);
  const start = index.indexOf('id="view-overview"');
  const end = index.indexOf('id="view-workbench"');
  const overview = index.slice(start, end);

  assert.match(overview, /id="overview-usage"/);
  assert.match(overview, /data-usage-source="proxy"/);
  assert.match(overview, /data-usage-source="runs"/);
  assert.match(overview, /data-usage-days="7"/);
  assert.match(overview, /data-usage-hero/);
  assert.match(overview, /data-usage-split/);
  assert.match(overview, /data-usage-trend-chart/);
  assert.match(overview, /data-usage-ledger="logs"/);
  assert.match(overview, /data-usage-ledger="providers"/);
  assert.match(overview, /data-usage-ledger="models"/);
  assert.match(overview, /id="overview-health-pills"/);
  assert.match(overview, /id="team-panel-container"/);
  assert.doesNotMatch(overview, /3\.1亿|\$89\.34|3,083|92\.9%|缓存命中率/);

  assert.match(app, /function loadUsageOverview\(/);
  assert.match(app, /function renderOverviewUsage\(/);
  assert.match(app, /API\.ccswitchProxyUsageOverview/);
  assert.match(app, /summarizeRuns\(/);
  assert.match(app, /不会预填演示数字/);
  assert.match(app, /usage\/summary\?days=/);
  assert.match(api, /ccswitchProxyUsageOverview: "\/api\/ccswitch\/proxy\/usage\/overview"/);
  assert.match(css, /\.overview-usage/);
  assert.match(css, /\.overview-hero/);
  assert.match(css, /\.overview-ledger-table/);
  assert.match(app, /data-usage-ledger/);
  assert.match(app, /usage\/providers\?days=/);
  assert.match(index, /lucide-git-branch[\s\S]*obs-routegate-count/);
});

test("instrument pages share paper content sections", async () => {
  const polish = await readFile(resolve(publicRoot, "forge/experience-polish.css"), "utf8");
  assert.match(polish, /#view-overview, #view-observability, #view-security, #view-sessions/);
  assert.match(polish, /\.content-section \{/);
  assert.match(polish, /#view-security \.security-posture/);
});
