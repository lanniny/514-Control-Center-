import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAvatarStore, MAX_AVATAR_BYTES, OPERATOR_DEFAULT_LABEL } from "../src/avatars.mjs";
import { TeamMemberStore } from "../src/team-members.mjs";

function runtimeProfile(id = "codex-technical") {
  return {
    id,
    label: id === "codex-technical" ? "Codex 技术执行" : id,
    shortLabel: "Codex",
    role: "technical-executor",
    description: "runtime",
    systemPrompt: "verify",
    capabilities: ["coding"],
    model: "gpt-test",
    defaultEffort: "high",
    modelOptions: [{ id: "gpt-test", label: "gpt-test" }],
    effortLevels: ["high", "xhigh"],
    provider: "openai",
    adapter: "codex-app-server",
    enabled: true,
    teamMemberEligible: true,
    coordinatorEligible: true,
  };
}

function minimalJpeg() {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0xff, 0xd9,
  ]);
}

function jpegDataUrl() {
  return `data:image/jpeg;base64,${minimalJpeg().toString("base64")}`;
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "cc-avatars-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const teamMembers = await new TeamMemberStore({
    dataRoot: root,
    runtimeCatalog: () => [runtimeProfile()],
    referencesForMember: async () => [],
    secureFile: async (path) => chmod(path, 0o600),
  }).load();
  const avatars = await createAvatarStore({ dataRoot: root, teamMembers }).init();
  return { root, teamMembers, avatars };
}

test("operator avatar defaults to AEMEATH and round-trips a custom photo", async (t) => {
  const { avatars } = await fixture(t);
  const initial = await avatars.operatorProfile();
  assert.equal(initial.label, OPERATOR_DEFAULT_LABEL);
  assert.equal(initial.avatar, "");
  await assert.rejects(() => avatars.readOperatorFile(), { code: "AVATAR_NOT_FOUND" });

  const saved = await avatars.setOperatorAvatar(jpegDataUrl());
  assert.equal(saved.avatar, "custom");
  const file = await avatars.readOperatorFile();
  assert.equal(file.mimeType, "image/jpeg");
  assert.ok(file.bytes.equals(minimalJpeg()));

  const cleared = await avatars.clearOperatorAvatar();
  assert.equal(cleared.avatar, "");
  await assert.rejects(() => avatars.readOperatorFile(), { code: "AVATAR_NOT_FOUND" });
});

test("member avatar writes the catalog flag and rejects unknown members before storing bytes", async (t) => {
  const { root, avatars, teamMembers } = await fixture(t);
  await assert.rejects(() => avatars.setMemberAvatar("missing-member", jpegDataUrl()), { code: "SOURCE_NOT_FOUND" });
  assert.deepEqual(await readdir(join(root, "uploads", "avatars")).catch(() => []), []);

  const updated = await avatars.setMemberAvatar("codex-technical", jpegDataUrl());
  assert.equal(updated.avatar, "custom");
  assert.equal(teamMembers.get("codex-technical").avatar, "custom");
  const file = await avatars.readMemberFile("codex-technical");
  assert.equal(file.mimeType, "image/jpeg");

  const cleared = await avatars.clearMemberAvatar("codex-technical");
  assert.equal(cleared.avatar, "");
  await assert.rejects(() => avatars.readMemberFile("codex-technical"), { code: "AVATAR_NOT_FOUND" });
});

test("avatar upload rejects oversized or mismatched images", async (t) => {
  const { avatars } = await fixture(t);
  await assert.rejects(() => avatars.setOperatorAvatar("not-an-image"), { code: "INVALID_IMAGE_DATA" });
  const huge = `data:image/jpeg;base64,${Buffer.alloc(MAX_AVATAR_BYTES + 32).toString("base64")}`;
  await assert.rejects(() => avatars.setOperatorAvatar(huge), { code: "IMAGE_TOO_LARGE" });
  const lying = `data:image/png;base64,${minimalJpeg().toString("base64")}`;
  await assert.rejects(() => avatars.setOperatorAvatar(lying), { code: "IMAGE_TYPE_MISMATCH" });
});
