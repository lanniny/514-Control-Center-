import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOfficeService } from "../src/office.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "514cc-office-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = createOfficeService({ repoRoot: dir, dataRoot: dir });
  return { dir, service, outDir: join(dir, "output-docs") };
}

test("office: docx generates a valid OOXML zip with paragraphs and table", async (t) => {
  const { service } = await fixture(t);
  const result = await service.generate({
    kind: "docx",
    title: "测试报告",
    fileName: "report",
    spec: { title: "测试报告", sections: [{ heading: "进展", paragraphs: ["第一条", "第二条"] }, { heading: "表", table: { rows: [["A", "B"], ["1", "2"]] } }] },
    dryRun: false,
  });
  assert.equal(result.ok, true);
  const bytes = await readFile(result.plan.path);
  assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK");
  const summary = (await service.inspect({ path: result.plan.path })).summary;
  assert.equal(summary.kind, "docx");
  assert.ok(summary.paragraphs >= 4, `paragraphs=${summary.paragraphs}`);
  assert.equal(summary.tables, 1);
});

test("office: xlsx generates and inspects sheets", async (t) => {
  const { service } = await fixture(t);
  const result = await service.generate({
    kind: "xlsx",
    fileName: "data.xlsx",
    spec: { sheets: [{ name: "汇总", columns: [{ header: "项目" }, { header: "数值" }], rows: [["甲", 1], ["乙", 2]] }] },
    dryRun: false,
  });
  const bytes = await readFile(result.plan.path);
  assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK");
  const summary = (await service.inspect({ path: result.plan.path })).summary;
  assert.equal(summary.sheets.length, 1);
  assert.equal(summary.sheets[0].name, "汇总");
  assert.ok(summary.sheets[0].rows >= 3);
});

test("office: pptx generates and counts slides", async (t) => {
  const { service } = await fixture(t);
  const result = await service.generate({
    kind: "pptx",
    fileName: "deck",
    spec: { slides: [{ title: "封面", bullets: ["一", "二"] }, { title: "结尾", bullets: ["谢谢"] }] },
    dryRun: false,
  });
  const bytes = await readFile(result.plan.path);
  assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK");
  const summary = (await service.inspect({ path: result.plan.path })).summary;
  assert.equal(summary.slides, 2);
});

test("office: dryRun plans without writing", async (t) => {
  const { service, outDir } = await fixture(t);
  const result = await service.generate({ kind: "docx", fileName: "plan-only", spec: {} });
  assert.equal(result.dryRun, true);
  assert.ok(result.plan.path.endsWith("plan-only.docx"));
  await assert.rejects(() => stat(result.plan.path), { code: "ENOENT" });
  assert.ok(result.plan.targetDir.startsWith(outDir.slice(0, 20)));
});

test("office: path escape and bad filename are refused", async (t) => {
  const { service } = await fixture(t);
  await assert.rejects(
    () => service.generate({ kind: "docx", fileName: "x", targetDir: "C:/Windows", spec: {}, dryRun: false }),
    { code: "OFFICE_PATH_BOUNDARY" },
  );
  await assert.rejects(
    () => service.generate({ kind: "docx", fileName: "../evil", spec: {} }),
    { code: "OFFICE_BAD_FILENAME" },
  );
  await assert.rejects(
    () => service.generate({ kind: "pdf", fileName: "x", spec: {} }),
    { code: "OFFICE_BAD_KIND" },
  );
});

test("office: history records generations newest-first", async (t) => {
  const { service } = await fixture(t);
  await service.generate({ kind: "docx", fileName: "h1", spec: {}, dryRun: false });
  await service.generate({ kind: "pptx", fileName: "h2", spec: {}, dryRun: false });
  const items = await service.history();
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, "pptx");
  assert.equal(items[1].kind, "docx");
  assert.ok(items.every((item) => item.bytes > 0));
});

test("office: templates catalog is non-empty and well-formed", async (t) => {
  const { service } = await fixture(t);
  const templates = service.templates();
  assert.equal(templates.length, 3);
  assert.ok(templates.every((template) => template.id && template.kind && template.spec));
});
