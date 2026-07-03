// Unit test for the streaming delimiter splitter — no API calls.
// Run: npx tsx scripts/splitter-test.ts
import assert from "node:assert";
import { createReplyExtractor } from "../src/interview/llm.js";
import { EVAL_DELIMITER } from "../src/interview/persona.js";

const JSON_TRAILER = `{"topic":"t","score":3,"completeness":2,"isVague":true,"isStrong":false,"coversNewArea":false,"note":"n","nextAction":"probe"}`;

function run(chunks: string[]) {
  let spoken = "";
  const ex = createReplyExtractor((d) => (spoken += d));
  for (const c of chunks) ex.push(c);
  const { reply, trailer } = ex.finish();
  return { spoken, reply, trailer };
}

// 1. Delimiter split across chunk boundaries — must never be spoken.
{
  const full = `Tell me more about that.\n${EVAL_DELIMITER}\n${JSON_TRAILER}`;
  for (const size of [1, 3, 7, 10, 999]) {
    const chunks: string[] = [];
    for (let i = 0; i < full.length; i += size) chunks.push(full.slice(i, i + size));
    const { spoken, reply, trailer } = run(chunks);
    assert.ok(!spoken.includes("<<<"), `size ${size}: delimiter leaked into speech: ${spoken}`);
    assert.strictEqual(reply, "Tell me more about that.", `size ${size}: bad reply`);
    assert.ok(trailer.includes('"nextAction":"probe"'), `size ${size}: bad trailer`);
    assert.ok(!spoken.includes("nextAction"), `size ${size}: JSON leaked into speech`);
  }
  console.log("✅ delimiter never leaks across any chunk boundary");
}

// 2. No trailer at all — everything is speech, held-back tail flushed.
{
  const { spoken, reply, trailer } = run(["Short reply", " with no", " trailer."]);
  assert.strictEqual(spoken, "Short reply with no trailer.");
  assert.strictEqual(reply, "Short reply with no trailer.");
  assert.strictEqual(trailer, "");
  console.log("✅ trailer-less output flushes fully as speech");
}

// 3. Angle brackets in speech that are NOT the delimiter still get spoken.
{
  const full = `I see <great> potential here.\n${EVAL_DELIMITER}${JSON_TRAILER}`;
  const { spoken, reply } = run([full]);
  assert.ok(spoken.includes("<great>"), "legit angle brackets were swallowed");
  assert.strictEqual(reply, "I see <great> potential here.");
  console.log("✅ non-delimiter angle brackets pass through");
}

// 4. Delimiter as the very first content (model skipped speech).
{
  const { spoken, reply, trailer } = run([`${EVAL_DELIMITER}${JSON_TRAILER}`]);
  assert.strictEqual(spoken, "");
  assert.strictEqual(reply, "");
  assert.ok(trailer.startsWith("{"));
  console.log("✅ speech-less output yields empty reply, intact trailer");
}

console.log("\nAll splitter tests passed.");
