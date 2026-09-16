import test from "node:test";
import assert from "node:assert/strict";
import { correctText } from "../src/services/correction.service.ts";

test("a token-limited correction preserves the complete long transcription", async (t) => {
  const original = `${"A complete sentence. ".repeat(2000)}Final words must survive.`;
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    choices: [{ finish_reason: "length", message: { content: "A partial correction." } }],
  })));
  assert.equal(await correctText(original, "test-only-key"), original);
});

test("a completed correction still replaces the raw transcription", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: "  A corrected sentence.  " } }],
  })));
  assert.equal(await correctText("a corrected sentence", "test-only-key"), "A corrected sentence.");
});
