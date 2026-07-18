import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { assertWithin, expandPathTemplate, isWithin, toPortablePath } from "./paths.mjs";
import { diffLines } from "./diff.mjs";
import { validateContent } from "./validator.mjs";

function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function sourceKind(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".json") return "json";
  if (extension === ".yaml" || extension === ".yml") return "yaml";
  if (extension === ".toml") return "toml";
  if (extension === ".md" || extension === ".mdc") return "markdown";
  if (extension === ".py") return "python";
  return "text";
}

function extractFrozenBlocks(content) {
  return content.match(/<frozen-after-approval(?:\s[^>]*)?>[\s\S]*?<\/frozen-after-approval>/g) || [];
}

async function walkFiles(root) {
  const files = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(root);
  return files;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export class ConfigManager {
  constructor({ repoRoot, dataRoot, registryPath, eventStore, beforeCommit = null, onCommitted = null }) {
    this.repoRoot = resolve(repoRoot);
    this.dataRoot = resolve(dataRoot);
    this.registryPath = registryPath;
    this.eventStore = eventStore;
    this.beforeCommit = beforeCommit;
    this.onCommitted = onCommitted;
    this.sources = new Map();
    this.plans = new Map();
    this.sourceLocks = new Map();
    this.commitChain = Promise.resolve();
  }

  async init() {
    const registry = JSON.parse(await readFile(this.registryPath, "utf8"));
    for (const item of registry.explicit) this.addRepoSource(item);

    for (const rule of registry.discover) {
      const root = assertWithin(this.repoRoot, resolve(this.repoRoot, rule.root), "discovery root");
      for (const path of await walkFiles(root)) {
        const nameMatch = rule.names?.includes(basename(path));
        const extensionMatch = rule.extensions?.includes(extname(path).toLowerCase());
        if (!nameMatch && !extensionMatch) continue;
        const repoPath = toPortablePath(relative(this.repoRoot, path));
        if ([...this.sources.values()].some((source) => source.path === path)) continue;
        this.addRepoSource({
          id: `repo:${repoPath}`,
          path: repoPath,
          label: repoPath,
          kind: sourceKind(path),
          scope: "repo",
          critical: Boolean(rule.critical),
        });
      }
    }

    for (const item of registry.runtime) {
      const path = expandPathTemplate(item.path);
      this.sources.set(item.id, {
        ...item,
        path,
        displayPath: item.path,
        exists: await exists(path),
        readOnly: true,
        exposeContent: false,
      });
    }
    await this.reconcileTransactions();
    return this;
  }

  async reconcileTransactions() {
    for (const source of this.sources.values()) {
      if (source.scope !== "repo" || source.writePolicy !== "transactional") continue;
      const backupDir = resolve(this.dataRoot, "..", "backups", "control-center", sha256(source.id));
      let entries = [];
      try { entries = await readdir(backupDir); } catch (error) { if (error.code !== "ENOENT") throw error; }
      for (const name of entries.filter((entry) => entry.endsWith(".manifest.json"))) {
        const manifestPath = join(backupDir, name);
        let manifest;
        try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch { continue; }
        if (manifest.sourceId !== source.id || manifest.sourcePath !== source.displayPath) continue;
        if (manifest.state === "committed" && manifest.auditStatus === "pending") {
          manifest.auditStatus = "degraded";
          manifest.auditError = "Recovered after restart before audit acknowledgement.";
          manifest.recoveredAt = new Date().toISOString();
          await this.atomicReplace(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
          await this.eventStore.emit("config.recovered", { sourceId: source.id, versionId: manifest.versionId, state: manifest.state }, { sensitivity: "internal" }).catch(() => {});
          continue;
        }
        if (manifest.state !== "prepared") continue;
        let currentSha256 = null;
        try { currentSha256 = sha256(await readFile(source.path, "utf8")); } catch {}
        if (currentSha256 === manifest.toSha256) {
          manifest.state = "committed";
          manifest.auditStatus = "degraded";
          manifest.auditError = "Recovered a committed write after restart.";
        } else if (currentSha256 === manifest.fromSha256) {
          manifest.state = "rolled_back";
          manifest.auditStatus = "not-required";
        } else {
          manifest.state = "inconsistent";
          manifest.auditStatus = "degraded";
          manifest.auditError = `Source hash ${currentSha256 || "missing"} matches neither transaction boundary.`;
          source.transactionBlocked = true;
        }
        manifest.recoveredAt = new Date().toISOString();
        await this.atomicReplace(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        await this.eventStore.emit("config.recovered", { sourceId: source.id, versionId: manifest.versionId, state: manifest.state }, { sensitivity: "internal" }).catch(() => {});
      }
    }
  }

  addRepoSource(item) {
    const path = assertWithin(this.repoRoot, resolve(this.repoRoot, item.path), "config source");
    this.sources.set(item.id, {
      writePolicy: "transactional",
      exposeContent: true,
      sensitive: false,
      ...item,
      kind: item.kind || sourceKind(path),
      path,
      displayPath: toPortablePath(relative(this.repoRoot, path)),
      readOnly: false,
    });
  }

  getSource(id) {
    const source = this.sources.get(id);
    if (!source) {
      const error = new Error(`unknown config source: ${id}`);
      error.code = "SOURCE_NOT_FOUND";
      throw error;
    }
    return source;
  }

  async listSources() {
    const items = [];
    for (const source of this.sources.values()) {
      const isPresent = await exists(source.path);
      source.exists = isPresent;
      items.push({
        id: source.id,
        label: source.label,
        path: source.displayPath,
        kind: source.kind,
        scope: source.scope,
        critical: Boolean(source.critical),
        sensitive: Boolean(source.sensitive),
        readOnly: source.scope !== "repo" || source.writePolicy !== "transactional",
        writePolicy: source.writePolicy,
        exposeContent: source.exposeContent !== false,
        exists: isPresent,
        transactionBlocked: Boolean(source.transactionBlocked),
      });
    }
    return items.sort((a, b) => a.scope.localeCompare(b.scope) || a.path.localeCompare(b.path));
  }

  async read(id) {
    const source = this.getSource(id);
    if (source.exposeContent === false) {
      return {
        id: source.id,
        label: source.label,
        path: source.displayPath,
        kind: source.kind,
        scope: source.scope,
        readOnly: true,
        sensitive: Boolean(source.sensitive),
        content: null,
        sha256: null,
        message: "该运行时配置只允许经同步/部署流程修改，原文不会返回前端。",
      };
    }
    if (source.scope === "repo") assertWithin(this.repoRoot, source.path, "config read");
    const metadata = await lstat(source.path);
    if (metadata.isSymbolicLink()) throw Object.assign(new Error("symbolic-link config sources are rejected"), { code: "SYMLINK_REJECTED" });
    const content = await readFile(source.path, "utf8");
    return {
      id: source.id,
      label: source.label,
      path: source.displayPath,
      kind: source.kind,
      scope: source.scope,
      critical: Boolean(source.critical),
      transactionBlocked: Boolean(source.transactionBlocked),
      readOnly: source.scope !== "repo" || source.writePolicy !== "transactional",
      content,
      sha256: sha256(content),
    };
  }

  async validate(id, content) {
    return validateContent(this.getSource(id), content);
  }

  async plan(id, content, baseSha256) {
    const source = this.getSource(id);
    if (source.transactionBlocked) {
      throw Object.assign(new Error("source is blocked by an inconsistent recovered transaction"), { code: "TRANSACTION_INCONSISTENT" });
    }
    const current = await this.read(id);
    if (current.readOnly) throw Object.assign(new Error("source is not directly writable"), { code: "READ_ONLY_SOURCE" });
    if (baseSha256 && current.sha256 !== baseSha256) {
      throw Object.assign(new Error("source changed since it was loaded"), { code: "STALE_BASE", currentSha256: current.sha256 });
    }
    const validation = await this.validate(id, content);
    const diff = diffLines(current.content, content);
    const planId = randomUUID();
    for (const [existingId, existing] of this.plans) {
      if (existing.expiresAt < Date.now()) this.plans.delete(existingId);
    }
    const plan = {
      sourceId: id,
      baseSha256: current.sha256,
      targetSha256: sha256(content),
      validation,
      diff,
      summary: diff.summary,
      requiresConfirmation: Boolean(this.getSource(id).critical),
      planId,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
    this.plans.set(planId, {
      sourceId: id,
      baseSha256: current.sha256,
      targetSha256: plan.targetSha256,
      expiresAt: Date.now() + 5 * 60_000,
    });
    return plan;
  }

  async atomicReplace(path, content) {
    const tempPath = join(dirname(path), `.${basename(path)}.514cc-${randomUUID()}.tmp`);
    const handle = await open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, path);
  }

  async withSourceLock(id, operation) {
    const previous = this.sourceLocks.get(id) || Promise.resolve();
    let release;
    const gate = new Promise((resolveGate) => { release = resolveGate; });
    const queued = previous.catch(() => {}).then(() => gate);
    this.sourceLocks.set(id, queued);
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (this.sourceLocks.get(id) === queued) this.sourceLocks.delete(id);
    }
  }

  async withCommitLock(operation) {
    const previous = this.commitChain;
    let release;
    const gate = new Promise((resolveGate) => { release = resolveGate; });
    this.commitChain = previous.catch(() => {}).then(() => gate);
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async apply(id, input) {
    return this.withCommitLock(() => this.withSourceLock(id, async () => {
      const result = await this.applyUnlocked(id, input);
      if (!result.changed || !result.committed || !this.onCommitted) return result;
      try {
        result.activation = await this.onCommitted({ sourceId: id, result });
      } catch (error) {
        result.activation = {
          status: "restart-required",
          reason: `configuration committed but live activation failed: ${error.message}`,
        };
      }
      return result;
    }));
  }

  async applyUnlocked(id, { content, baseSha256, planId, confirmation, actor = "operator", reason = "edit" }) {
    const source = this.getSource(id);
    if (source.transactionBlocked) {
      throw Object.assign(new Error("source is blocked by an inconsistent recovered transaction"), { code: "TRANSACTION_INCONSISTENT" });
    }
    if (source.scope !== "repo" || source.writePolicy !== "transactional") {
      throw Object.assign(new Error("runtime/generated sources require the deployment workflow"), { code: "DEPLOYMENT_REQUIRED" });
    }
    assertWithin(this.repoRoot, source.path, "config write");
    const metadata = await lstat(source.path);
    if (metadata.isSymbolicLink()) throw Object.assign(new Error("symbolic-link config sources are rejected"), { code: "SYMLINK_REJECTED" });
    if (source.critical && confirmation !== id) {
      throw Object.assign(new Error(`critical source requires confirmation bound to ${id}`), { code: "CONFIRMATION_REQUIRED" });
    }

    const current = await this.read(id);
    if (!baseSha256 || current.sha256 !== baseSha256) {
      throw Object.assign(new Error("source changed since it was loaded"), { code: "STALE_BASE", currentSha256: current.sha256 });
    }
    const validation = await this.validate(id, content);
    if (!validation.valid) throw Object.assign(new Error("candidate configuration is invalid"), { code: "VALIDATION_FAILED", validation });
    await this.beforeCommit?.({ sourceId: id, content, current });
    const targetSha256 = sha256(content);
    const planned = this.plans.get(planId);
    if (!planned || planned.expiresAt < Date.now()) {
      if (planId) this.plans.delete(planId);
      throw Object.assign(new Error("a fresh configuration plan is required before apply"), { code: "PLAN_REQUIRED" });
    }
    if (planned.sourceId !== id || planned.baseSha256 !== baseSha256 || planned.targetSha256 !== targetSha256) {
      throw Object.assign(new Error("configuration content does not match the approved plan"), { code: "PLAN_MISMATCH" });
    }
    if (JSON.stringify(extractFrozenBlocks(current.content)) !== JSON.stringify(extractFrozenBlocks(content))) {
      throw Object.assign(new Error("frozen-after-approval content cannot be changed from the control center"), { code: "FROZEN_BLOCK" });
    }

    if (targetSha256 === current.sha256) {
      this.plans.delete(planId);
      return { changed: false, sha256: current.sha256, validation };
    }

    const commitBase = await this.read(id);
    if (commitBase.sha256 !== current.sha256) {
      throw Object.assign(new Error("source changed while the transaction was being prepared"), {
        code: "STALE_BASE",
        currentSha256: commitBase.sha256,
      });
    }

    const versionId = `${new Date().toISOString().replace(/[:.]/g, "-")}--${current.sha256.slice(0, 12)}`;
    const backupDir = resolve(this.dataRoot, "..", "backups", "control-center", sha256(id));
    assertWithin(resolve(this.dataRoot, "..", "backups", "control-center"), backupDir, "backup path");
    await mkdir(backupDir, { recursive: true });
    const backupPath = join(backupDir, `${versionId}.bak`);
    const manifestPath = join(backupDir, `${versionId}.manifest.json`);
    await writeFile(backupPath, current.content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const manifest = {
      versionId,
      sourceId: id,
      sourcePath: source.displayPath,
      createdAt: new Date().toISOString(),
      actor,
      reason,
      fromSha256: current.sha256,
      toSha256: targetSha256,
      backupSha256: current.sha256,
      backupPath: basename(backupPath),
      state: "prepared",
      auditStatus: "pending",
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });

    let rolledBack = false;
    try {
      await this.atomicReplace(source.path, content);
      const readback = await readFile(source.path, "utf8");
      const readbackValidation = await this.validate(id, readback);
      if (!readbackValidation.valid || sha256(readback) !== targetSha256) throw new Error("post-write readback validation failed");
    } catch (error) {
      try {
        await this.atomicReplace(source.path, await readFile(backupPath, "utf8"));
        rolledBack = true;
      } catch (rollbackError) {
        error.rollbackError = rollbackError.message;
      }
      error.rolledBack = rolledBack;
      throw error;
    }

    manifest.state = "committed";
    manifest.committedAt = new Date().toISOString();
    let auditDegraded = false;
    let auditError = null;
    try {
      await this.atomicReplace(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    } catch (error) {
      auditDegraded = true;
      auditError = `manifest commit marker failed: ${error.message}`;
    }
    try {
      await this.eventStore.emit(
        "config.changed",
        { sourceId: id, path: source.displayPath, fromSha256: current.sha256, toSha256: targetSha256, versionId, actor, reason },
        { sensitivity: "internal" },
      );
      manifest.auditStatus = "recorded";
    } catch (error) {
      auditDegraded = true;
      auditError = error.message;
      manifest.auditStatus = "degraded";
      manifest.auditError = error.message;
    }
    try {
      await this.atomicReplace(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    } catch (error) {
      auditDegraded = true;
      auditError ||= `manifest finalization failed: ${error.message}`;
      source.transactionBlocked = true;
    }
    this.plans.delete(planId);
    return { changed: true, committed: true, auditDegraded, auditError, sha256: targetSha256, previousSha256: current.sha256, versionId, validation };
  }

  async versions(id) {
    const source = this.getSource(id);
    const backupDir = resolve(this.dataRoot, "..", "backups", "control-center", sha256(id));
    if (!isWithin(resolve(this.dataRoot, "..", "backups", "control-center"), backupDir)) return [];
    let entries;
    try {
      entries = await readdir(backupDir);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const versions = [];
    for (const name of entries.filter((entry) => entry.endsWith(".manifest.json"))) {
      try {
        const manifest = JSON.parse(await readFile(join(backupDir, name), "utf8"));
        if (manifest.sourceId !== id || manifest.sourcePath !== source.displayPath) continue;
        if (manifest.state !== "committed") continue;
        const backupPath = assertWithin(backupDir, resolve(backupDir, manifest.backupPath), "version backup");
        const backupContent = await readFile(backupPath, "utf8");
        if (sha256(backupContent) !== manifest.backupSha256 || manifest.backupSha256 !== manifest.fromSha256) continue;
        versions.push(manifest);
      } catch {
        // Preserve malformed manifests on disk but do not expose them as valid rollback points.
      }
    }
    return versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // 回滚预览：取某个已提交版本的原文。复用 versions() 的 manifest + 哈希链校验（坏版本本就不出现在列表里），
  // 与 rollback() 同一套 backupPath 边界断言；只读不改，供前端预览后再决定是否真正 rollback。
  async versionContent(id, versionId) {
    const manifest = (await this.versions(id)).find((entry) => entry.versionId === versionId);
    if (!manifest) throw Object.assign(new Error("config version not found"), { code: "VERSION_NOT_FOUND" });
    const backupDir = resolve(this.dataRoot, "..", "backups", "control-center", sha256(id));
    const backupPath = assertWithin(backupDir, resolve(backupDir, manifest.backupPath), "version backup");
    const content = await readFile(backupPath, "utf8");
    return {
      id,
      versionId: manifest.versionId,
      path: manifest.sourcePath,
      createdAt: manifest.createdAt,
      actor: manifest.actor ?? null,
      reason: manifest.reason ?? null,
      sha256: manifest.backupSha256,
      content,
    };
  }

  async rollback(id, { versionId, baseSha256, confirmation, actor = "operator" }) {
    const manifest = (await this.versions(id)).find((entry) => entry.versionId === versionId);
    if (!manifest) throw Object.assign(new Error("rollback version not found"), { code: "VERSION_NOT_FOUND" });
    const backupDir = resolve(this.dataRoot, "..", "backups", "control-center", sha256(id));
    const backupPath = assertWithin(backupDir, resolve(backupDir, manifest.backupPath), "rollback backup");
    const content = await readFile(backupPath, "utf8");
    const plan = await this.plan(id, content, baseSha256);
    const result = await this.apply(id, {
      content,
      baseSha256,
      planId: plan.planId,
      confirmation,
      actor,
      reason: `rollback:${versionId}`,
    });
    try {
      await this.eventStore.emit("config.rolled_back", { sourceId: id, restoredVersionId: versionId, sha256: result.sha256 }, { sensitivity: "internal" });
    } catch (error) {
      result.auditDegraded = true;
      result.auditError ||= `rollback audit event failed: ${error.message}`;
      result.auditErrors = [...(result.auditErrors || []), result.auditError];
    }
    return result;
  }
}

export { sha256 };
