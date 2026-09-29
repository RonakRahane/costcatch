"use client";

import { useEffect, useRef, useState } from "react";
import Verbatim from "./Verbatim";
import { CAPTURES, type CaptureId } from "@/data/captures";

type Section = { id: string; label: string; group: "start" | "commands" | "reference" };

const GLOSSARY: [string, React.ReactNode][] = [
  [
    "a call",
    "One request from your program to an AI model. A single question from a user often takes several, because the model asks for information and then reads the answer.",
  ],
  [
    "a token",
    <>
      The chunk of text providers charge by — roughly four characters of English, so about 750
      words per thousand tokens. You pay separately for what you send (<em>in</em>) and what comes
      back (<em>out</em>), and sending is usually the cheaper half.
    </>,
  ],
  [
    "a tool call",
    "The model asking your own code to do something it cannot — look something up, do some arithmetic — and then reading the answer you send back. Each round trip is another call, and another charge.",
  ],
  [
    "the prompt",
    "Everything sent to the model in one call. It grows on every turn, because each turn re-sends the whole conversation so far plus whatever the tools returned. That growth is where surprise costs come from.",
  ],
  [
    "reasoning tokens",
    <>
      Tokens a model spends thinking before it answers. A <em>subset</em> of the completion
      tokens, not additional to them, and billed at the same rate — so they do not change what a
      call cost, they explain it. Often the majority of the output on a reasoning model.
    </>,
  ],
  [
    "cached tokens",
    "Part of a prompt the provider had already seen and charges less for. costcatch reports it separately, so you can tell a genuinely large prompt from a mostly-cached one.",
  ],
  [
    "a run",
    <>
      One execution of your program, and the file costcatch saves for it in{" "}
      <code>.costcatch/</code>. Every command below reads that same file, which is why you can
      compare, re-read and total up runs long after they have finished.
    </>,
  ],
];

const SECTIONS: Section[] = [
  { id: "start", label: "Install", group: "start" },
  { id: "words", label: "Terminology", group: "start" },
  { id: "internals", label: "How it works", group: "start" },
  { id: "help", label: "costcatch --help", group: "start" },

  { id: "init", label: "init", group: "commands" },
  { id: "run", label: "run", group: "commands" },
  { id: "watch", label: "watch", group: "commands" },
  { id: "show", label: "show", group: "commands" },
  { id: "replay", label: "replay", group: "commands" },
  { id: "diff", label: "diff", group: "commands" },
  { id: "stats", label: "stats", group: "commands" },
  { id: "estimate", label: "estimate", group: "commands" },
  { id: "clean", label: "clean", group: "commands" },

  { id: "flags", label: "run flags", group: "reference" },
  { id: "security", label: "Security & redaction", group: "reference" },
  { id: "gates", label: "Gates", group: "reference" },
  { id: "exits", label: "Exit codes", group: "reference" },
  { id: "limits", label: "Limitations", group: "reference" },
  { id: "trace", label: "Trace format", group: "reference" },
  { id: "warnings", label: "Warning engine", group: "reference" },
  { id: "errors", label: "Error paths", group: "reference" },
];

const GROUP_LABEL: Record<Section["group"], string> = {
  start: "getting started",
  commands: "the nine commands",
  reference: "reference",
};

const FLAGS: [string, string][] = [
  ["--save", "Keep the run as a file, so show, replay, diff and stats can read it later"],
  ["--save-as <name>", "Always write to the same filename, so you can keep one run as a fixed point to compare against"],
  ["--json", "Print the run as JSON for another program to read; your own output moves aside so the two never get mixed up"],
  ["--quiet", "Just the total, on one line"],
  ["--no-color", "Flat indented lines instead of the box — for log files, where box drawing is noise"],
  ["--no-cost", "Hide the money columns, keep the token ones"],
  ["--no-redact", "Leave names, emails and phone numbers in the saved file. Passwords and keys are always removed either way"],
  ["--inspect", "Print the whole conversation after the run"],
  ["--compare-last", "Compare against the previous run of this script automatically. Saves the run too"],
  ["--filter <provider>", "Watch one provider only. The name is checked against the real list, so a typo is loud rather than silent"],
  ["--threshold <ms>", "Say what counts as slow yourself, instead of letting costcatch work it out from the run"],
  ["--max-cost <usd>", "After the run: fail if it cost more than this"],
  ["--max-calls <n>", "After the run: fail if it made more calls than this"],
  ["--budget <usd>", "While it runs: stop the program the moment spend passes this"],
];

const EXITS: [string, string, string][] = [
  ["0", "Success", "The run completed and every gate passed"],
  ["1", "GateFailed", "--max-cost, --max-calls or --budget was breached, or estimate --max-cost was exceeded"],
  ["2", "Usage", "Bad flag, unknown provider, undetectable runtime, clean with no criterion"],
  ["70", "Internal", "costcatch's own failure — a missing interceptor, an unwritable temp directory"],
  ["child's code", "—", "Otherwise the traced program's exit status passes through untouched"],
];

const TRACE_FIELDS: [string, string][] = [
  ["runId", "The timestamp that names the run. It is also the filename, so you can paste it straight into show, replay or diff"],
  ["totalCostUsd", "Empty if even one call used a model with no price. Never a half-finished sum — which is why the cost check fails rather than passing"],
  ["inputTokens", "The full size of the prompt that went out, counted the same way for every provider"],
  ["cachedTokens", "How much of that prompt the provider had already seen and charged less for. Always part of inputTokens, never on top of it"],
  ["reasoningTokens", "How much of the output was thinking. Always part of outputTokens, never on top of it, and billed at the same rate. null when the provider reports no split — Anthropic bills thinking inside output_tokens without breaking it out"],
  ["toolCalls", "What the model asked your code to do on that call, with the arguments it passed"],
  ["retryOf", "Set when this call re-sends a prompt an earlier call already sent"],
  ["content.truncated", "Set once the saved text hits its size limit, so an empty record is never mistaken for a call that sent nothing"],
  ["summary.retries", "How many prompts were sent more than once. wastedCostUsd is what those repeats cost you"],
];

const WARNINGS: [string, string, string][] = [
  ["http_error", "critical", "A call came back with an error rather than an answer"],
  ["context_growth", "warn / critical", "The last prompt is at least 3× the size of the first. 10× or more is critical"],
  ["context_spike", "warn", "One prompt is at least 4× the size of the one just before it"],
  ["duplicate_tool_call", "warn / info", "The same tool was asked the same thing twice, or something more than 80% alike"],
  ["cost_concentration", "warn", "A single call accounts for more than half of what the whole run cost"],
  ["latency_spike", "info", "One call took 2.5× as long as the middle of the others, and more than 5 seconds"],
];

// Keep this in the same order as the list the init panel prints.
const SPLASH_COMMANDS: [string, string][] = [
  ["run", "trace a script (default)"],
  ["estimate", "estimate prompt token cost"],
  ["show", "inspect conversation content"],
  ["diff", "compare two saved traces"],
  ["stats", "aggregated analytics"],
  ["replay", "re-display a saved trace"],
  ["watch", "run, always saved"],
  ["clean", "prune old saved traces"],
  ["init", "setup & fetch pricing"],
];

function Usage({ children }: { children: React.ReactNode }) {
  return (
    <div className="doc-usage">
      <span className="p" aria-hidden>
        $&nbsp;
      </span>
      {children}
    </div>
  );
}

function Cap({ id, note }: { id: CaptureId; note?: string }) {
  const c = CAPTURES[id];
  return <Verbatim command={c.command} output={c.output} exitCode={c.exitCode} note={note} />;
}

function CmdHead({ name, no, kicker }: { name: string; no: string; kicker: string }) {
  return (
    <div className="doc-cmd-head">
      <h2 className="doc-cmd-name">{name}</h2>
      <span className="doc-cmd-no">{no}</span>
      <span className="label">{kicker}</span>
    </div>
  );
}

export default function Docs() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const railRef = useRef<HTMLElement | null>(null);

  // The rootMargin makes the rail mark the heading you're reading, not the tallest section on screen.
  useEffect(() => {
    const nodes = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (n): n is HTMLElement => Boolean(n)
    );

    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "-96px 0px -66% 0px", threshold: 0 }
    );

    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);

  // On narrow screens the rail is a horizontal strip, so scroll the marked item into view.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || rail.scrollWidth <= rail.clientWidth) return;
    rail
      .querySelector<HTMLElement>(`a[href="#${active}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  return (
    <div className="canvas">
      <div className="docs-grid">
        <aside className="docs-rail" ref={railRef} aria-label="Documentation contents">
          {(["start", "commands", "reference"] as const).map((g) => (
            <div className="docs-rail-group" key={g}>
              <div className="docs-rail-label">{GROUP_LABEL[g]}</div>
              {SECTIONS.filter((s) => s.group === g).map((s, i) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className={active === s.id ? "on" : undefined}
                  aria-current={active === s.id ? "true" : undefined}
                >
                  <span className="n">{String(i + 1).padStart(2, "0")}</span>
                  {s.label}
                </a>
              ))}
            </div>
          ))}
        </aside>

        <div className="docs-main">
          <section className="doc-sec" id="start">
            <div className="label">
              <span className="sig" aria-hidden />
              reference · not a tour
            </div>
            <h1 className="doc-h1">costcatch reference</h1>
            <p className="doc-p">
              Nine commands, all reading the same JSON in <code>.costcatch/</code>.{" "}
              <code>run</code> is the default and may be omitted:{" "}
              <code>costcatch python agent.py</code> is equivalent to{" "}
              <code>costcatch run python agent.py</code>.
            </p>
            <p className="doc-p">
              Every framed block on this page is captured output, reproduced exactly — whitespace,
              box rules, column alignment and exit status included. Nothing here is a mock-up of
              output the tool does not produce. Wide blocks scroll horizontally rather than
              reflowing, because a reflowed box is no longer evidence.
            </p>

            <h3 className="doc-h2">Requirements</h3>
            <div className="tblwrap"><table className="tbl">
              <tbody>
                <tr>
                  <td>Node.js</td>
                  <td>
                    ≥ 18.17 — required to run costcatch itself, whichever runtime you trace
                  </td>
                </tr>
                <tr>
                  <td>Python</td>
                  <td>
                    3.8+, and only to trace Python agents. The interceptor ships inside the npm
                    package; there is nothing to <code>pip install</code>.
                  </td>
                </tr>
              </tbody>
            </table></div>

            <h3 className="doc-h2">Install from source</h3>
            <div className="note">
              <b>v0.1.0 is not yet published to npm.</b> The release workflow exists with provenance
              attestation, but no tag has been pushed — so{" "}
              <code>npm install -g costcatch</code> resolves to a 404 today. Install from source
              until it is tagged.
            </div>
            <Usage>git clone https://github.com/RonakRahane/costcatch</Usage>
            <Usage>cd costcatch &amp;&amp; npm install &amp;&amp; npm run build &amp;&amp; npm link</Usage>
            <p className="doc-p">
              <code>npm link</code> puts <code>costcatch</code> on your <code>PATH</code>, pointing
              at <code>dist/index.js</code>. Verify with <code>costcatch --help</code>.
            </p>

            <h3 className="doc-h2">Once published</h3>
            <p className="doc-p">
              When v0.1.0 is tagged, both of these will work and the source install becomes
              unnecessary:
            </p>
            <Usage>npm install -g costcatch</Usage>
            <Usage>npx costcatch python agent.py</Usage>

            <h3 className="doc-h2">Initialise a project</h3>
            <Usage>costcatch init</Usage>
            <p className="doc-p">
              Creates <code>.costcatch/</code>, adds it to <code>.gitignore</code>, and fetches the
              pricing table. See <code>init</code> below for the full output.
            </p>

            <div className="note">
              <b>Options go before your command, not after it.</b> costcatch hands everything after{" "}
              <code>python</code> or <code>node</code> straight to your program — the same rule{" "}
              <code>time</code> and <code>env</code> follow. So{" "}
              <code>costcatch python agent.py --save</code> gives <code>--save</code> to{" "}
              <em>your agent</em>, not to costcatch. It spots that mistake and tells you, rather
              than quietly doing nothing.
            </div>
          </section>

          <section className="doc-sec" id="words">
            <h2 className="doc-h1">Terminology</h2>
            <p className="doc-p">
              Six terms recur throughout this reference. They are defined here once and used
              without further qualification below.
            </p>
            <dl className="gloss">
              {GLOSSARY.map(([term, body]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{body}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="doc-sec" id="internals">
            <h2 className="doc-h1">How it works</h2>
            <p className="doc-p">
              Six stages, no configuration at any of them.
            </p>

            <h3 className="doc-h2">1 · Runtime detection and the argv split</h3>
            <p className="doc-p">
              costcatch classifies the first argument as Python (<code>python</code>,{" "}
              <code>python3</code>, <code>python3.12</code>) or Node (<code>node</code>,{" "}
              <code>nodejs</code>, <code>npx</code>, <code>tsx</code>, <code>ts-node</code>) and
              splits <code>argv</code>{" "}
              at that executable: everything before it is costcatch&apos;s,
              everything after is yours. This is the rule <code>time</code> and <code>env</code>{" "}
              follow, and it is why <code>costcatch python agent.py --save</code> passes{" "}
              <code>--save</code> to your agent. Because that surprises people, costcatch detects
              the case and reports it on stderr rather than silently doing nothing.
            </p>

            <h3 className="doc-h2">2 · Interceptor injection</h3>
            <div className="tblwrap"><table className="tbl">
              <thead>
                <tr>
                  <th>runtime</th>
                  <th>mechanism</th>
                  <th>patched surfaces</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="dim">Node</td>
                  <td>
                    <code>--require preload.cjs</code>, or <code>NODE_OPTIONS</code> when the
                    executable is a launcher such as <code>npx</code>
                  </td>
                  <td>
                    <code>globalThis.fetch</code>, <code>https.request</code>,{" "}
                    <code>http.request</code>, <code>https.get</code>, <code>http.get</code>
                  </td>
                </tr>
                <tr>
                  <td className="dim">Python</td>
                  <td>
                    prepends the interceptor directory to <code>PYTHONPATH</code> so{" "}
                    <code>sitecustomize.py</code> auto-loads
                  </td>
                  <td>
                    <code>httpx.Client</code>, <code>httpx.AsyncClient</code>,{" "}
                    <code>urllib3.HTTPConnectionPool</code>
                  </td>
                </tr>
              </tbody>
            </table></div>
            <div className="note">
              Patching <code>urllib3</code> and <code>httpx</code> covers <code>requests</code>, the
              OpenAI and Anthropic SDKs, LangChain, LiteLLM and CrewAI, because nearly everything is
              built on one of those two. If your environment already defines a{" "}
              <code>sitecustomize</code>, costcatch chains to it rather than shadowing it.
            </div>

            <h3 className="doc-h2">3 · Observation, never interference</h3>
            <p className="doc-p">
              The interceptor is purely observational, and this is the property the whole design
              protects:
            </p>
            <div className="tblwrap"><table className="tbl">
              <tbody>
                <tr>
                  <td className="dim">failure mode</td>
                  <td>
                    every patched path is wrapped, so an internal fault degrades to &quot;captured
                    nothing&quot;, never &quot;broke your agent&quot;
                  </td>
                </tr>
                <tr>
                  <td className="dim">response bodies</td>
                  <td>cloned or spliced back, never consumed out from under you</td>
                </tr>
                <tr>
                  <td className="dim">streaming</td>
                  <td>
                    tee&apos;d as you consume them, so <code>stream=True</code> keeps working
                  </td>
                </tr>
                <tr>
                  <td className="dim">errors</td>
                  <td>
                    an unhandled error stays unhandled; installing costcatch will not turn a crash
                    into a silent hang
                  </td>
                </tr>
                <tr>
                  <td className="dim">memory</td>
                  <td>
                    bounded at 2 MiB per response and 64 MiB per run, so a tracer cannot OOM the
                    program it watches
                  </td>
                </tr>
                <tr>
                  <td className="dim">headers</td>
                  <td>
                    never read — which is why an API key cannot appear in a trace even in principle
                  </td>
                </tr>
              </tbody>
            </table></div>

            <h3 className="doc-h2">4 · Two-phase NDJSON protocol</h3>
            <p className="doc-p">
              The interceptor writes newline-delimited JSON to a temp file. Each call produces two
              records: <code>phase: &quot;start&quot;</code> when the request is dispatched, and{" "}
              <code>phase: &quot;end&quot;</code> with a correlation id when the response completes.
              Two records rather than one is what makes the live view possible, keeps timing correct
              for overlapping concurrent calls, and lets the report render progressively instead of
              only at the end.
            </p>

            <h3 className="doc-h2">5 · Building the trace</h3>
            <p className="doc-p">
              Records are folded into calls in a fixed order, and the order matters:
            </p>
            <div className="tblwrap"><table className="tbl">
              <tbody>
                <tr>
                  <td className="dim">1</td>
                  <td>
                    synthetic capture-limit records are dropped — counting them would inflate{" "}
                    <code>llmCalls</code> and trip <code>--max-calls</code> on its own
                  </td>
                </tr>
                <tr>
                  <td className="dim">2</td>
                  <td>
                    <code>--filter</code> is applied <em>before</em> calls are numbered, so the
                    summary and the report always describe the same subset
                  </td>
                </tr>
                <tr>
                  <td className="dim">3</td>
                  <td>the provider registry parses each body</td>
                </tr>
                <tr>
                  <td className="dim">4</td>
                  <td>each call is priced</td>
                </tr>
                <tr>
                  <td className="dim">5</td>
                  <td>conversation content is extracted and redacted</td>
                </tr>
                <tr>
                  <td className="dim">6</td>
                  <td>retries are marked — a call whose prompt matches an earlier one</td>
                </tr>
                <tr>
                  <td className="dim">7</td>
                  <td>the warning engine runs</td>
                </tr>
              </tbody>
            </table></div>

            <h3 className="doc-h2">6 · Rendering</h3>
            <p className="doc-p">
              On an interactive colour TTY a pinned box repaints roughly twelve times a second.
              Everywhere else — CI, a pipe, <code>--json</code>, <code>--quiet</code>,{" "}
              <code>--no-color</code> — output falls back to sequential lines with no cursor
              control, safe for log files.
            </p>
          </section>

          <section className="doc-sec" id="help">
            <h2 className="doc-h1">costcatch --help</h2>
            <p className="doc-p">
              Everything costcatch can do, on one screen. If an option is not in here, it does not
              exist.
            </p>
            <Cap id="help" />
          </section>
        </div>
      </div>
    </div>
  );
}
