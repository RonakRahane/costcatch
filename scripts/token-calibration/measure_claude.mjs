// Measures Claude token counts for the corpus with the free count_tokens API, one model per tokenizer family.
// Counts leave out the message framing, which is the count for a one-character message minus one.
// Usage: node --env-file=.env scripts/token-calibration/measure_claude.mjs   (resumes from data/claude_progress.json)
// Needs @anthropic-ai/sdk, which costcatch does not depend on: npm install --no-save @anthropic-ai/sdk
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "node:fs";
import * as path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PROGRESS = path.join(HERE, "data", "claude_progress.json");
const corpus = JSON.parse(fs.readFileSync(path.join(HERE, "data", "corpus.json"), "utf8"));
const byId = new Map(corpus.map((s) => [s.id, s]));
const PROBES = ["prose_en-001", "code_ts-001", "json-001", "cjk_zh-001", "hi-001", "short-001", "emoji_chat-001", "logs-001"];
for (const id of PROBES) if (!byId.has(id)) throw new Error(`probe ${id} missing from corpus`);

const client = new Anthropic({ maxRetries: 5 });
const state = fs.existsSync(PROGRESS) ? JSON.parse(fs.readFileSync(PROGRESS, "utf8")) : { models: null, probe: {}, errors: {}, full: {} };
const save = () => fs.writeFileSync(PROGRESS, JSON.stringify(state, null, 1));

// At most 40 requests a minute.
const GAP_MS = 1500;
let last = 0;
async function count(model, content) {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const r = await client.messages.countTokens({ model, messages: [{ role: "user", content }] });
  return r.input_tokens;
}
const why = (e) => `${e?.status ?? ""} ${e?.error?.error?.type ?? e?.name ?? ""}: ${String(e?.error?.error?.message ?? e?.message ?? e).slice(0, 200)}`.trim();

const t0 = Date.now();
if (!state.models) {
  state.models = [];
  for await (const m of client.models.list({ limit: 100 })) state.models.push({ id: m.id, display_name: m.display_name, created_at: m.created_at });
  save();
}
console.log(`${state.models.length} models listed`);

for (const { id: model } of state.models) {
  if (state.probe[model] || state.errors[model]) continue;
  try {
    const framing = (await count(model, "x")) - 1;
    const probes = {};
    for (const pid of PROBES) probes[pid] = (await count(model, byId.get(pid).text)) - framing;
    state.probe[model] = { framing, probes };
    console.log(`probed ${model}: framing ${framing}, ${PROBES.map((p) => probes[p]).join(" ")}`);
  } catch (e) {
    state.errors[model] = why(e);
    console.log(`skipped ${model}: ${state.errors[model]}`);
  }
  save();
}

// Models with the same counts on every probe share a tokenizer family.
const families = new Map();
for (const { id: model } of state.models) {
  const p = state.probe[model];
  if (!p) continue;
  const sig = PROBES.map((pid) => p.probes[pid]).join(",");
  if (!families.has(sig)) families.set(sig, []);
  families.get(sig).push(model);
}
state.families = [...families.values()].map((members) => ({ members, representative: members[0], framing: state.probe[members[0]].framing }));
save();
console.log(`${state.families.length} families: ${state.families.map((f) => `[${f.members.join(", ")}]`).join(" ")}`);

for (const fam of state.families) {
  const rep = fam.representative;
  state.full[rep] ??= {};
  for (const s of corpus) {
    if (state.full[rep][s.id] !== undefined) continue;
    try {
      state.full[rep][s.id] = (await count(rep, s.text)) - fam.framing;
    } catch (e) {
      state.full[rep][s.id] = null;
      (state.sampleErrors ??= {})[`${rep}:${s.id}`] = why(e);
    }
    if (Object.keys(state.full[rep]).length % 25 === 0) {
      save();
      console.log(`${rep}: ${Object.keys(state.full[rep]).length}/${corpus.length}`);
    }
  }
  save();
  console.log(`${rep}: all ${corpus.length} counted`);
}
console.log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
