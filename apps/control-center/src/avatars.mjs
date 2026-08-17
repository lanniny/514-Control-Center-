import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { detectClipboardImageType } from "./clipboard-attachment.mjs";

export const MAX_AVATAR_BYTES = 1024 * 1024;
export const MAX_AVATAR_REQUEST_BYTES = Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 4096;
export const OPERATOR_DEFAULT_LABEL = "AEMEATH";

const STORE_VERSION = 1;
const IMAGE_EXT = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
});
const EXT_MIME = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
});

function fail(message, code = "VALIDATION_FAILED") {
  throw Object.assign(new Error(message), { code });
}

function parseAvatarDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") fail("avatar dataUrl is required", "INVALID_IMAGE_DATA");
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(dataUrl);
  if (!match) fail("avatar must be a base64 data URL", "INVALID_IMAGE_DATA");
  const declaredType = match[1].toLowerCase();
  if (!IMAGE_EXT[declaredType]) fail(`unsupported avatar type: ${declaredType}`, "UNSUPPORTED_IMAGE_TYPE");
  const encoded = match[2];
  if (!encoded || encoded.length % 4 !== 0) fail("avatar base64 is malformed", "INVALID_IMAGE_DATA");
  if (encoded.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4) {
    fail(`avatar exceeds ${MAX_AVATAR_BYTES} bytes`, "IMAGE_TOO_LARGE");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) fail("avatar base64 is malformed", "INVALID_IMAGE_DATA");
  if (!bytes.length) fail("avatar is empty", "INVALID_IMAGE_DATA");
  if (bytes.length > MAX_AVATAR_BYTES) fail(`avatar exceeds ${MAX_AVATAR_BYTES} bytes`, "IMAGE_TOO_LARGE");
  const detected = detectClipboardImageType(bytes);
  if (!detected) fail("avatar bytes are not a valid image", "INVALID_IMAGE_DATA");
  if (detected !== declaredType) fail("avatar MIME type does not match file bytes", "IMAGE_TYPE_MISMATCH");
  return { mimeType: detected, bytes };
}

function safeFileStem(id) {
  const stem = String(id ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128);
  if (!stem || stem === "." || stem === "..") fail("avatar owner id is invalid", "VALIDATION_FAILED");
  return stem;
}

async function writeAtomicBytes(path, bytes) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let renamed = false;
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temp, 0o600).catch(() => {});
    await rename(temp, path);
    renamed = true;
  } finally {
    if (!renamed) await rm(temp, { force: true });
  }
}

async function writeAtomicJson(path, value) {
  await writeAtomicBytes(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

export function createAvatarStore({ dataRoot, teamMembers } = {}) {
  if (typeof dataRoot !== "string" || !dataRoot.trim()) fail("dataRoot is required", "VALIDATION_FAILED");
  if (!teamMembers || typeof teamMembers.get !== "function" || typeof teamMembers.setAvatar !== "function") {
    fail("teamMembers store is required", "VALIDATION_FAILED");
  }
  const root = resolve(dataRoot);
  const avatarDir = join(root, "uploads", "avatars");
  const operatorPath = join(root, "operator-profile.json");

  function memberPrefix(memberId) {
    return `member--${safeFileStem(memberId)}`;
  }

  async function listFiles(prefix) {
    let names;
    try {
      names = await readdir(avatarDir);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    return names.filter((name) => {
      const dot = name.lastIndexOf(".");
      if (dot <= 0) return false;
      const stem = name.slice(0, dot);
      const ext = name.slice(dot + 1).toLowerCase();
      return stem === prefix && Object.hasOwn(EXT_MIME, ext);
    });
  }

  async function removeFiles(prefix) {
    const names = await listFiles(prefix);
    await Promise.all(names.map((name) => rm(join(avatarDir, name), { force: true })));
  }

  async function readFileRecord(prefix) {
    const names = await listFiles(prefix);
    if (!names.length) return null;
    const name = names.sort().at(-1);
    const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    const bytes = await readFile(join(avatarDir, name));
    if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) return null;
    const mimeType = detectClipboardImageType(bytes) || EXT_MIME[ext];
    if (!mimeType) return null;
    return { bytes, mimeType, fileName: name };
  }

  async function saveFile(prefix, dataUrl) {
    const { mimeType, bytes } = parseAvatarDataUrl(dataUrl);
    const path = join(avatarDir, `${prefix}.${IMAGE_EXT[mimeType]}`);
    await removeFiles(prefix);
    await writeAtomicBytes(path, bytes);
    return { mimeType, bytes: bytes.length };
  }

  async function readOperatorRecord() {
    try {
      const parsed = JSON.parse(await readFile(operatorPath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultOperator();
      const label = typeof parsed.label === "string" && parsed.label.trim()
        ? parsed.label.trim().slice(0, 48)
        : OPERATOR_DEFAULT_LABEL;
      return {
        label,
        avatar: parsed.avatar === "custom" ? "custom" : "",
      };
    } catch (error) {
      if (error?.code === "ENOENT") return defaultOperator();
      fail("operator profile is unreadable", "OPERATOR_PROFILE_UNREADABLE");
    }
  }

  function defaultOperator() {
    return { label: OPERATOR_DEFAULT_LABEL, avatar: "" };
  }

  async function writeOperatorRecord(record) {
    await writeAtomicJson(operatorPath, {
      version: STORE_VERSION,
      label: record.label,
      avatar: record.avatar === "custom" ? "custom" : "",
    });
    return readOperatorRecord();
  }

  return {
    async init() {
      await mkdir(avatarDir, { recursive: true, mode: 0o700 });
      return this;
    },

    async operatorProfile() {
      const record = await readOperatorRecord();
      if (record.avatar === "custom" && !(await readFileRecord("operator"))) {
        return { ...record, avatar: "" };
      }
      return record;
    },

    async setOperatorAvatar(dataUrl) {
      await saveFile("operator", dataUrl);
      const current = await readOperatorRecord();
      return writeOperatorRecord({ ...current, avatar: "custom" });
    },

    async clearOperatorAvatar() {
      const current = await readOperatorRecord();
      const next = await writeOperatorRecord({ ...current, avatar: "" });
      await removeFiles("operator");
      return next;
    },

    async setMemberAvatar(memberId, dataUrl) {
      const member = teamMembers.get(memberId);
      await saveFile(memberPrefix(member.id), dataUrl);
      try {
        return await teamMembers.setAvatar(member.id, "custom");
      } catch (error) {
        await removeFiles(memberPrefix(member.id));
        throw error;
      }
    },

    async clearMemberAvatar(memberId) {
      const member = teamMembers.get(memberId);
      const updated = await teamMembers.setAvatar(member.id, "");
      await removeFiles(memberPrefix(member.id));
      return updated;
    },

    async removeMemberFile(memberId) {
      await removeFiles(memberPrefix(memberId));
    },

    async readOperatorFile() {
      const file = await readFileRecord("operator");
      if (!file) fail("operator avatar not found", "AVATAR_NOT_FOUND");
      return file;
    },

    async readMemberFile(memberId) {
      const member = teamMembers.get(memberId);
      const file = await readFileRecord(memberPrefix(member.id));
      if (!file) fail("member avatar not found", "AVATAR_NOT_FOUND");
      return file;
    },
  };
}
