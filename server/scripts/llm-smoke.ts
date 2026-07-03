// Live-fire check of the interview brain with the key in .env.
// Run:  npm run llm:smoke --workspace server
import {
  buildMergedTurnDirective,
  buildStableSystem,
} from "../src/interview/persona.js";
import { completeOnce, streamMergedTurn, MODELS } from "../src/interview/llm.js";
import { generateReport } from "../src/interview/report.js";
import { initialRunningState, type CandidateProfile } from "../src/types.js";

const profile: CandidateProfile = {
  name: "Test Candidate",
  role: "Backend Engineer",
  experienceLevel: "mid",
};
const stable = buildStableSystem("behavioral", profile);
const running = initialRunningState();

console.log("Model tiers:", MODELS, "\n");

console.log(`1) TURN tier (${MODELS.turn}) — opening line:`);
const opening = await completeOnce(
  stable,
  `Begin the interview now. Greet ${profile.name} by name, introduce yourself, and ask your first question in 2-3 short sentences.`,
);
console.log(`   "${opening}"\n`);

console.log(`2) MERGED turn — vague answer (expect nextAction=probe, isVague=true):`);
process.stdout.write("   🗣 speaks: ");
const vague = await streamMergedTurn(
  stable,
  buildMergedTurnDirective("explore", true, running),
  [
    { role: "assistant", content: opening },
    {
      role: "user",
      content: "Umm, I worked on a project once with some people and it went fine I guess.",
    },
  ],
  (delta) => process.stdout.write(delta),
);
console.log("\n   eval:", vague.evaluation);
console.log(
  `   nextAction=${vague.nextAction}, parsed=${vague.evaluationParsed}`,
);
console.log(
  vague.evaluationParsed && vague.evaluation.isVague && vague.nextAction === "probe"
    ? "   ✅ scored + probed in ONE call\n"
    : "   ⚠️  unexpected — inspect output above\n",
);

// The strong-answer branch costs an extra call; run with --full to include it
// (free-tier daily quotas are small, so the default run stays lean).
let strongReply = "Thanks — that's a strong, specific example.";
if (process.argv.includes("--full")) {
  console.log(`3) MERGED turn — strong answer (expect nextAction=advance):`);
  process.stdout.write("   🗣 speaks: ");
  const strong = await streamMergedTurn(
    stable,
    buildMergedTurnDirective("explore", true, running),
    [
      { role: "assistant", content: opening },
      {
        role: "user",
        content:
          "I led the migration of our payments service to a queue-based design. I wrote the RFC, got buy-in from three teams, and we cut failed transactions by 40% within two months.",
      },
    ],
    (delta) => process.stdout.write(delta),
  );
  console.log("\n   eval:", strong.evaluation);
  console.log(
    `   nextAction=${strong.nextAction}, parsed=${strong.evaluationParsed}`,
  );
  console.log(
    strong.evaluationParsed && !strong.evaluation.isVague && strong.nextAction === "advance"
      ? "   ✅ acknowledged + advanced in ONE call\n"
      : "   ⚠️  unexpected — inspect output above\n",
  );
  strongReply = strong.reply;
} else {
  console.log(`3) (skipped strong-answer turn — pass --full to include it)\n`);
}

console.log(`4) REPORT tier (${MODELS.report}) — structured feedback report:`);
const report = await generateReport("behavioral", profile, [
  { role: "assistant", content: opening },
  {
    role: "user",
    content:
      "I led the migration of our payments service to a queue-based design. I convinced the team, wrote the RFC, and we cut failed transactions by 40% in two months.",
  },
  { role: "assistant", content: strongReply },
  {
    role: "user",
    content:
      "Honestly the hardest part was a teammate who disagreed; I set up a spike to compare both approaches and we went with the data.",
  },
]);
console.log(`   overallScore: ${report.overallScore}`);
console.log(`   summary: ${report.summary}`);
console.log(
  `   dimensions: ${report.dimensions.length}, strengths: ${report.strengths.length}, improvements: ${report.improvements.length}`,
);
console.log("\n✅ The merged interview brain is live.");
