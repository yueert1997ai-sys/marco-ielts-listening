import test from "node:test";
import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";

import { filterItems, findCanonical, keyFor, lookupDictionary, modesFor } from "../public/logic.js";
import {
  makeSession, mergePending, nextLoginFailure, singularCandidates, validTerm,
  validateModes, verifyPassword, verifySession,
} from "../src/worker.js";

const items = [
  { id: "curtain", term: "curtain", meaning: "窗帘", modes: ["spelling"], numberVariants: ["curtains"], isRealError: true },
  { id: "certain", term: "certain", meaning: "确定的", modes: ["recognition"], isRealError: false },
  { id: "colossal", term: "colossal", meaning: "巨大的", modes: ["recognition"], sourceType: "user", isRealError: true },
];

test("key generation is stable", () => assert.equal(keyFor("Low profit margins"), "low-profit-margins"));
test("plural aliases resolve to one card", () => assert.equal(findCanonical(items, "curtains").id, "curtain"));
test("conservative plural fallback maps certains to certain", () => assert.equal(findCanonical(items, "certains").id, "certain"));
test("irregular plural candidates include child", () => assert(singularCandidates("children").includes("child")));
test("mode selector converts both into two activities", () => assert.deepEqual(modesFor("both"), ["recognition", "spelling"]));
test("worker mode validation rejects empty lists", () => assert.equal(validateModes([]), null));
test("terms allow IELTS phrases and numeric-leading contracts", () => {
  assert(validTerm("12-month maternity cover contract"));
  assert(!validTerm("Large pans of sap called evaporators are heated by means of a fire"));
  assert(!validTerm("<script>"));
});
test("dictionary lookup follows lemma aliases", () => {
  const dictionary = {
    entries: { curtain: { word: "curtain", translation: "窗帘" } },
    aliases: { curtains: "curtain" },
  };
  assert.equal(lookupDictionary(dictionary, "curtains").word, "curtain");
});
test("filters distinguish base and personal words", () => {
  assert.deepEqual(filterItems(items, "", "custom").map((item) => item.id), ["colossal"]);
  assert(filterItems(items, "窗帘", "all").some((item) => item.id === "curtain"));
});
test("pending intake merges into an existing card instead of duplicating it", () => {
  const merged = mergePending(items, [], [{
    operation: "intake", status: "pending",
    payload: { term: "curtains", canonicalTerm: "curtain", modes: ["recognition"], addedAt: "2026-08-27" },
  }]);
  assert.equal(merged.filter((item) => item.id === "curtain").length, 1);
  assert.deepEqual(merged.find((item) => item.id === "curtain").modes, ["recognition", "spelling"]);
});
test("archived entries stay visible for recovery", () => {
  const merged = mergePending(items, [{ id: "archived", archived: true, snapshot: { term: "archived", meaning: "归档" } }], []);
  assert(merged.find((item) => item.id === "archived").archived);
});

test("password hash validation accepts only the matching password", async () => {
  const salt = Buffer.from("marco-admin-test-salt");
  const iterations = 1000;
  const digest = pbkdf2Sync("correct horse battery", salt, iterations, 32, "sha256");
  const stored = `pbkdf2$${iterations}$${salt.toString("base64url")}$${digest.toString("base64url")}`;
  assert.equal(await verifyPassword("correct horse battery", stored), true);
  assert.equal(await verifyPassword("wrong password", stored), false);
});

test("signed sessions reject tampering", async () => {
  const session = await makeSession("test-session-secret-that-is-long");
  assert.equal(await verifySession(session, "test-session-secret-that-is-long"), true);
  assert.equal(await verifySession(`${session}x`, "test-session-secret-that-is-long"), false);
});

test("fifth login failure starts a temporary lock", () => {
  const now = 1_000_000;
  const state = nextLoginFailure({ attempts: 4, window_started_at: now - 1000 }, now);
  assert.equal(state.attempts, 5);
  assert(state.lockedUntil > now);
  const reset = nextLoginFailure({ attempts: 4, window_started_at: 0 }, now);
  assert.equal(reset.attempts, 1);
  assert.equal(reset.lockedUntil, 0);
});
