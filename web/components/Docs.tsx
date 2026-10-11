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
  ["--budget <usd>", "While it runs: stop the program once spend passes this, or a call can't be priced"],
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

          <section className="doc-sec" id="init">
            <div className="doc-cmd">
              <CmdHead name="init" no="01 / 09" kicker="setup & pricing" />
              <Usage>costcatch init [--offline]</Usage>
              <p className="doc-p">
                Sets costcatch up in the current folder: makes a <code>.costcatch/</code> folder to
                keep saved runs in, tells git to ignore it, downloads the price list, and prints the
                panel below. There is nothing to configure after this — no config file, no key, no
                project id, no account.
              </p>
              <div className="framed">
                <span className="frame-ver">v0.1.0</span>
                <div className="splash">
                  <div className="splash-col">
                    <h4>About</h4>
                    <p>
                      Zero-instrumentation LLM agent tracer &amp; cost tracker. Like{" "}
                      <code>time</code>, for AI agents.
                    </p>
                    <h4>Features</h4>
                    <ul className="splash-list">
                      <li>live trace in the terminal</li>
                      <li>per-call cost tracking</li>
                      <li>prompt cost estimation</li>
                      <li>auto-diff between runs</li>
                      <li>CI assertion gates</li>
                      <li>secret &amp; PII redaction</li>
                    </ul>
                  </div>
                  <div className="splash-col">
                    <h4>Commands</h4>
                    <div>
                      {SPLASH_COMMANDS.map(([name, desc]) => (
                        <div className="splash-cmd" key={name}>
                          <b>{name}</b>
                          <span>{desc}</span>
                        </div>
                      ))}
                    </div>
                    <h4>Quick start</h4>
                    <div className="splash-cmd">
                      <b>$</b>
                      <span>costcatch python3 agent.py</span>
                    </div>
                    <div className="splash-cmd">
                      <b>$</b>
                      <span>costcatch node agent.mjs</span>
                    </div>
                  </div>
                </div>
              </div>

              <h3 className="doc-h2">The same panel, as the terminal draws it</h3>
              <Cap id="init" />

              <h3 className="doc-h2">On a machine with no internet</h3>
              <p className="doc-p">
                <code>--offline</code> skips the download and uses the copy of the price list that
                ships inside the package, so costcatch works on a machine that cannot reach the
                internet at all.
              </p>
              <Cap id="initOffline" note="--offline" />
            </div>
          </section>

          <section className="doc-sec" id="run">
            <div className="doc-cmd">
              <CmdHead name="run" no="02 / 09" kicker="the default command" />
              <Usage>costcatch run [flags] &lt;command&gt;</Usage>
              <p className="doc-p">
                Runs a Python or Node command and prices it. Your program&apos;s own output comes
                through untouched, and costcatch&apos;s report follows it. Read each row left to
                right: whether the call worked, which call it was, how long it took, tokens in and
                out, what it cost, a bar comparing that cost to the most expensive call in the run,
                and how much of the prompt the provider had already cached.
              </p>
              <p className="doc-p">
                The <code>├─ ▸</code> lines underneath are the tools the model asked for on that
                call. Putting each one under the call that asked is what makes an agent readable —
                call 1 below wanted two weather lookups and a multiplication.
              </p>
              <Cap id="run" note="--save" />

              <div className="note">
                <b>The bottom line is the one that matters.</b> A single run costing{" "}
                <code>$0.00019</code> sounds like nothing. At a thousand runs a day it is{" "}
                <code>$5.59 a month</code> for this one agent — and that is the number worth arguing
                about, which is why costcatch always prints it.
              </div>

              <h3 className="doc-h2">--quiet · just the total</h3>
              <Cap id="runQuiet" note="--quiet" />

              <h3 className="doc-h2">--no-color · for log files</h3>
              <p className="doc-p">
                Not the same box with the colour taken out, but a different layout altogether: flat
                indented lines. Box drawing in a build log is noise rather than structure.
              </p>
              <Cap id="runNoColor" note="--no-color" />

              <h3 className="doc-h2">--json · for other programs to read</h3>
              <p className="doc-p">
                The run goes to standard output and your program&apos;s own output moves to standard
                error, so the two never get mixed together in a pipeline. costcatch also waits until
                the very end to set its exit code, so nothing is cut off partway down a pipe —{" "}
                <code>costcatch --json … | jq</code> relies on that.
              </p>
              <Cap id="runJson" note="--json" />

              <h3 className="doc-h2">--inspect · show the whole conversation</h3>
              <Cap id="runInspect" note="--inspect" />

              <h3 className="doc-h2">--compare-last · did my change help?</h3>
              <p className="doc-p">
                Change a prompt, run it, and see what moved against the previous run of the same
                script — without having to name either file. This saves the run too, so you do not
                need <code>--save</code> as well.
              </p>
              <Cap id="runCompareLast" note="--compare-last" />

              <h3 className="doc-h2">--save-as, --no-cost</h3>
              <p className="doc-p">
                <code>--save-as</code> always writes to the same filename, which is how you keep
                one run around as a fixed point to compare everything else against.{" "}
                <code>--no-cost</code> hides the money columns and keeps the token ones.
              </p>
              <Cap id="runSaveAs" note="--save-as baseline --no-cost" />

              <h3 className="doc-h2">--threshold · say what &quot;too slow&quot; means</h3>
              <p className="doc-p">
                By default costcatch works out what counts as slow from the run itself. This
                replaces that with a number of milliseconds you choose, for when you already know.
              </p>
              <Cap id="runThreshold" note="--threshold 3000" />

              <h3 className="doc-h2">--no-redact · keep names and emails in the file</h3>
              <p className="doc-p">
                By default costcatch hides personal details before saving. This turns that off. It
                does <em>not</em> turn off secret-stripping: passwords, keys and tokens are removed
                every time, whatever you pass.
              </p>
              <Cap id="runNoRedact" note="--no-redact" />
            </div>
          </section>

          <section className="doc-sec" id="watch">
            <div className="doc-cmd">
              <CmdHead name="watch" no="03 / 09" kicker="always live, always saved" />
              <Usage>costcatch watch [flags] &lt;command&gt;</Usage>
              <p className="doc-p">
                The same as <code>run</code> with two things switched on: the live view stays up
                for the whole run, and the run is always saved. Every <code>run</code> option works
                here too — <code>--save</code> is just redundant.
              </p>
              <Cap id="watch" />
              <div className="note">
                The live view redraws over itself, and only when you are watching a real terminal.
                It survives a task runner that prefixes every line it forwards — turborepo, nx —
                because a redraw contains exactly one newline and reaches every row by cursor
                movement, so a label injected at line starts never lands inside the box; under
                turborepo the box is also indented to sit beneath the labels. Down a pipe or in CI it
                drops to one line per call and the box at exit.
              </div>
            </div>
          </section>

          <section className="doc-sec" id="show">
            <div className="doc-cmd">
              <CmdHead name="show" no="04 / 09" kicker="read the conversation" />
              <Usage>costcatch show [file] [--step N] [--grep term]</Usage>
              <p className="doc-p">
                Shows what was actually sent and received in a saved run: the instructions you
                gave, every message, what your tools sent back, and what the model replied. With no
                filename it opens the most recent run in <code>.costcatch/</code>.
              </p>
              <Cap id="showStep" note="--step 2" />

              <h3 className="doc-h2">--grep · find the turn it happened on</h3>
              <p className="doc-p">
                Searches the saved text and prints only the calls that match — for when you know
                what appeared but not which turn it appeared on.
              </p>
              <Cap id="showGrep" note="--grep" />
            </div>
          </section>

          <section className="doc-sec" id="replay">
            <div className="doc-cmd">
              <CmdHead name="replay" no="05 / 09" kicker="offline re-render" />
              <Usage>costcatch replay [file] [--json] [--no-cost]</Usage>
              <p className="doc-p">
                Prints a saved run&apos;s report again. Nothing is sent, nothing is charged, and
                your agent does not run a second time — the saved file already holds everything the
                report needs.
              </p>
              <Cap id="replay" />
              <h3 className="doc-h2">--no-cost</h3>
              <Cap id="replayNoCost" note="--no-cost" />
            </div>
          </section>

          <section className="doc-sec" id="diff">
            <div className="doc-cmd">
              <CmdHead name="diff" no="06 / 09" kicker="compare two runs" />
              <Usage>costcatch diff [a] [b] [--json]</Usage>
              <p className="doc-p">
                Compares two saved runs. With no arguments it takes the last two runs of the same
                script, which is what you want right after changing a prompt. It shows what moved in
                the things that cost money — number of calls, tools used, biggest prompt, total —
                plus the tools each run used that the other did not.
              </p>
              <Cap id="diff" />
              <h3 className="doc-h2">--json</h3>
              <Cap id="diffJson" note="--json" />
            </div>
          </section>

          <section className="doc-sec" id="stats">
            <div className="doc-cmd">
              <CmdHead name="stats" no="07 / 09" kicker="spend across every run" />
              <Usage>
                costcatch stats [--today|--week] [--script &lt;name&gt;] [--model &lt;name&gt;]
                [--json]
              </Usage>
              <p className="doc-p">
                Adds up every saved run: which scripts cost the most, which models cost the most,
                the average size of a run, and the slowest runs. This is the end-of-month view —
                which script, and which model, is actually taking the money.
              </p>
              <Cap id="stats" />
              <h3 className="doc-h2">--json</h3>
              <Cap id="statsJson" note="--json" />
            </div>
          </section>

          <section className="doc-sec" id="estimate">
            <div className="doc-cmd">
              <CmdHead name="estimate" no="08 / 09" kicker="before you spend" />
              <Usage>
                costcatch estimate [file] [--text &quot;…&quot;] [--model a,b] [--breakdown]
                [--max-cost &lt;usd&gt;] [--json]
              </Usage>
              <p className="doc-p">
                Tells you how many tokens a prompt is and what it will cost to send, without
                sending it. A model with no price on the list prints <code>$?.??</code> rather than
                a guess.
              </p>
              <Cap id="estimateCompare" note="--model gpt-4o,claude-sonnet-4,…" />

              <h3 className="doc-h2">--breakdown · which part is the expensive part</h3>
              <p className="doc-p">
                Splits a prompt up section by section. This is how you find the 400-token block of
                instructions nobody has read since the day it was written.
              </p>
              <Cap id="estimateBreakdown" note="--breakdown" />

              <h3 className="doc-h2">--json</h3>
              <Cap id="estimateJson" note="--json" />

              <h3 className="doc-h2">--max-cost · fail before anything is sent</h3>
              <p className="doc-p">
                <code>estimate</code> takes a cost limit as well, so a prompt template can fail your
                build before it has ever reached a model.
              </p>
              <Cap id="estimateGate" note="--max-cost" />
            </div>
          </section>

          <section className="doc-sec" id="clean">
            <div className="doc-cmd">
              <CmdHead name="clean" no="09 / 09" kicker="retention" />
              <Usage>costcatch clean [--keep N] [--older-than D] [--dry-run]</Usage>
              <p className="doc-p">
                Deletes old saved runs. The two options narrow each other rather than adding up:{" "}
                <code>--keep</code> is a floor, not a second way of choosing, so{" "}
                <code>--keep 10 --older-than 7</code> deletes anything older than a week{" "}
                <em>except</em> the ten most recent.
              </p>
              <Cap id="cleanNoCriterion" note="no criterion given" />
              <p className="doc-p">
                On its own it refuses to do anything, because the default behaviour of a delete
                command must never be a guess. <code>--dry-run</code> lists exactly what would go,
                without touching a thing:
              </p>
              <Cap id="cleanDryRun" note="--keep 4 --dry-run" />
            </div>
          </section>

          <section className="doc-sec" id="flags">
            <div className="label">
              <span className="sig" aria-hidden />
              reference
            </div>
            <h2 className="doc-h1" style={{ marginTop: 12 }}>
              run flags
            </h2>
            <p className="doc-p">
              All of these work with <code>run</code> and with <code>watch</code>, except that{" "}
              <code>watch</code> saves the run whether you ask it to or not.
            </p>
            <div className="tblwrap"><table className="tbl">
              <tbody>
                {FLAGS.map(([flag, body]) => (
                  <tr key={flag}>
                    <td>
                      <code>{flag}</code>
                    </td>
                    <td>{body}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>

          <section className="doc-sec" id="security">
            <h2 className="doc-h1">Security &amp; redaction</h2>

            <h3 className="doc-h2">Your API key cannot be captured</h3>
            <p className="doc-p">
              The interceptor never reads request headers, and a key travels in a header. Verified
              against the real 73-character <code>OPENROUTER_API_KEY</code> from <code>.env</code>:
            </p>
            <div className="tblwrap"><table className="tbl">
              <thead>
                <tr>
                  <th>check</th>
                  <th>result</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>API key present in the saved trace</td>
                  <td className="ok">0 occurrences</td>
                </tr>
                <tr>
                  <td>
                    any <code>authorization</code> field
                  </td>
                  <td className="ok">0</td>
                </tr>
                <tr>
                  <td>
                    any <code>sk-…</code> token
                  </td>
                  <td className="ok">0</td>
                </tr>
                <tr>
                  <td>trace file permissions</td>
                  <td>
                    <code>-rw-------</code> (0600)
                  </td>
                </tr>
                <tr>
                  <td>PII in the prompt</td>
                  <td>
                    masked to <code>«email»</code> / <code>«phone»</code>
                  </td>
                </tr>
              </tbody>
            </table></div>

            <h3 className="doc-h2">Redaction — three tiers, on by default</h3>
            <div className="tblwrap"><table className="tbl">
              <thead>
                <tr>
                  <th>tier</th>
                  <th>covers</th>
                  <th>removable</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="dim">Control characters</td>
                  <td>
                    ANSI escapes, <code>\r</code>, control bytes
                  </td>
                  <td className="bad">never</td>
                </tr>
                <tr>
                  <td className="dim">Secrets</td>
                  <td>
                    provider keys (<code>sk-</code>, <code>sk-ant-</code>, <code>ya29.</code>,{" "}
                    <code>xapp-</code>, <code>npm_</code>, <code>pypi-</code>,{" "}
                    <code>sk-or-v1-</code>), PEM blocks, <code>Bearer</code>/<code>Basic</code>/
                    <code>Digest</code> headers, <code>api_key:</code>/<code>secret=</code>/
                    <code>password=</code> pairs
                  </td>
                  <td className="bad">never</td>
                </tr>
                <tr>
                  <td className="dim">PII</td>
                  <td>emails, phone numbers, card numbers</td>
                  <td className="warn">
                    yes, with <code>--no-redact</code>
                  </td>
                </tr>
              </tbody>
            </table></div>
            <div className="note">
              Redaction patterns are bounded (<code>{"{20,512}"}</code>,{" "}
              <code>{"{8,4096}"}</code>) rather than greedy, because prompt length is entirely
              user-controlled and an unbounded backtracking pattern here would be a CPU-exhaustion
              vector (CWE-1333). Two tests hold the line: an absolute per-KB ceiling and a
              hardware-independent ratio check that catches super-linear scaling on any machine.
            </div>

            <h3 className="doc-h2">Process, filesystem, network</h3>
            <div className="tblwrap"><table className="tbl">
              <tbody>
                <tr>
                  <td className="dim">process spawning</td>
                  <td>
                    <code>shell: false</code> everywhere; no <code>exec</code>,{" "}
                    <code>execSync</code> or <code>shell: true</code> anywhere in{" "}
                    <code>src/</code>. On Windows, <code>.cmd</code>/<code>.bat</code> targets are
                    spawned through a manually quoted <code>cmd.exe</code> command line with{" "}
                    <code>windowsVerbatimArguments</code>, so a path like{" "}
                    <code>{"C:\my & agents\run.py"}</code> cannot be reinterpreted as shell
                    syntax.
                  </td>
                </tr>
                <tr>
                  <td className="dim">path traversal</td>
                  <td>
                    <code>--save-as</code> is sanitised to <code>[a-zA-Z0-9._-]</code>, so{" "}
                    <code>--save-as ../../../tmp/pwned</code> cannot escape{" "}
                    <code>.costcatch/</code>.
                  </td>
                </tr>
                <tr>
                  <td className="dim">clean</td>
                  <td>
                    targets come only from a listing jailed to <code>.costcatch/</code> that returns
                    regular <code>.json</code> files, so a planted symlink is not followed;{" "}
                    <code>pricing.json</code> is excluded by name.
                  </td>
                </tr>
                <tr>
                  <td className="dim">writes</td>
                  <td>
                    serialised to a sibling temp file and renamed, mode <code>0600</code>. An
                    interrupted run leaves either the old file or the new one, never a truncated
                    document that <code>stats</code> and <code>diff</code> would skip forever.
                  </td>
                </tr>
                <tr>
                  <td className="dim">reads</td>
                  <td>
                    every saved trace is treated as untrusted: fields are coerced with fallbacks,
                    control characters are stripped on read, and a trace carrying a{" "}
                    <code>__proto__</code> key does not pollute <code>Object.prototype</code>.
                  </td>
                </tr>
                <tr>
                  <td className="dim">network</td>
                  <td>
                    exactly two outbound requests, both HTTPS, both only from <code>init</code>,
                    both optional, both with 10-second timeouts: LiteLLM&apos;s pricing JSON and
                    OpenRouter&apos;s public model listing. No telemetry; no trace data leaves the
                    machine.
                  </td>
                </tr>
                <tr>
                  <td className="dim">dependencies</td>
                  <td>
                    five runtime dependencies, <code>npm audit --omit=dev</code> reports 0
                    vulnerabilities. No LLM SDK, no HTTP client, no native modules.
                  </td>
                </tr>
              </tbody>
            </table></div>

            <h3 className="doc-h2">Known advisories</h3>
            <div className="note">
              <b>--no-redact writes raw PII to disk indefinitely.</b>{" "}
              <code>.costcatch/</code> is gitignored by <code>init</code> and <code>clean</code>{" "}
              provides retention, but the flag produces plaintext PII in a file and prints no
              on-screen warning that it did.
            </div>
          </section>

          <section className="doc-sec" id="gates">
            <h2 className="doc-h1">Gates</h2>
            <p className="doc-p">
              Three options, but only two kinds of promise. <code>--max-cost</code> and{" "}
              <code>--max-calls</code> are checks on a run that has already finished — you still get
              the full report, and then a framed notice gives you the comparison.{" "}
              <code>--budget</code> is a limit on a run still in progress: it stops your program
              as soon as a finished call takes the total over the line, or can&apos;t be priced.
            </p>

            <div className="tblwrap"><table className="tbl">
              <thead>
                <tr>
                  <th>flag</th>
                  <th>guarantee</th>
                  <th>where it belongs</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>--max-cost</code>
                  </td>
                  <td>this run did not cost more than N — checked afterwards</td>
                  <td className="dim">CI</td>
                </tr>
                <tr>
                  <td>
                    <code>--max-calls</code>
                  </td>
                  <td>this run did not get stuck in a loop — checked afterwards</td>
                  <td className="dim">CI</td>
                </tr>
                <tr>
                  <td>
                    <code>--budget</code>
                  </td>
                  <td>
                    stopped once its spend passes N — calls already sent still finish and bill
                  </td>
                  <td className="warn">
                    your own machine, overnight jobs, agents you don&apos;t trust
                  </td>
                </tr>
              </tbody>
            </table></div>

            <h3 className="doc-h2">--max-cost, passing</h3>
            <Cap id="maxCostPass" note="--max-cost 0.50" />

            <h3 className="doc-h2">--max-cost, failing</h3>
            <Cap id="maxCostFail" note="--max-cost 0.000001" />

            <div className="note">
              <b>Gates fail closed.</b> If any call used a model costcatch cannot price, the run
              total stays <code>null</code> and the cost gate <em>fails</em> rather than passing. A
              gate that cannot be evaluated must never report success.
            </div>

            <h3 className="doc-h2">--max-calls · catch a loop that never ends</h3>
            <p className="doc-p">
              A cost limit misses one particular failure: a cheap model going round in circles
              forever. Five calls where you expected two is a broken loop even when the money
              involved is trivial.
            </p>
            <Cap id="maxCalls" note="--max-calls 2" />

            <h3 className="doc-h2">--budget · stop the program mid-run</h3>
            <p className="doc-p">
              Notice what is different below. This agent normally makes four to six calls; this run
              has two, and the notice appears <em>above</em> the report rather than below it,
              because the run was stopped rather than finished.
            </p>
            <Cap id="budget" note="--budget 0.00005 · process killed" />
          </section>

          <section className="doc-sec" id="exits">
            <h2 className="doc-h1">Exit codes</h2>
            <p className="doc-p">
              costcatch waits until the very end to set its exit code, so nothing it printed is
              ever cut off partway down a pipe.
            </p>
            <div className="tblwrap"><table className="tbl">
              <thead>
                <tr>
                  <th>code</th>
                  <th>name</th>
                  <th>when</th>
                </tr>
              </thead>
              <tbody>
                {EXITS.map(([code, name, when]) => (
                  <tr key={code}>
                    <td>
                      <code className="money">{code}</code>
                    </td>
                    <td className="dim">{name}</td>
                    <td>{when}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="note">
              <b>That last row is the important one.</b> costcatch wraps your program, so a program
              that fails must still fail. It replaces the exit code only when it has something of
              its own to report.
            </div>
          </section>

          <section className="doc-sec" id="limits">
            <h2 className="doc-h1">Limitations</h2>
            <p className="doc-p">
              Stated plainly, because a tool that hides its edges wastes your time.
            </p>
            <div className="tblwrap"><table className="tbl">
              <thead>
                <tr>
                  <th>limitation</th>
                  <th>detail</th>
                  <th>workaround</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Node and Python only</td>
                  <td>
                    bun and deno do not honour <code>--require</code>, so costcatch would attach and
                    capture nothing. It refuses rather than pretending.
                  </td>
                  <td className="dim">
                    run the script under <code>node</code>
                  </td>
                </tr>
                <tr>
                  <td>HTTP layer only</td>
                  <td>An SDK using a transport other than the patched ones is invisible.</td>
                  <td className="dim">the empty-trace message lists what is supported</td>
                </tr>
                <tr>
                  <td>
                    <code>estimate</code> is ±10%
                  </td>
                  <td>
                    Character-ratio heuristics, not a real tokenizer; input cost only, not output.
                  </td>
                  <td className="dim">
                    use <code>run</code> for exact spend
                  </td>
                </tr>
                <tr>
                  <td>Cost accuracy tracks the pricing table</td>
                  <td>
                    A model missing from LiteLLM and OpenRouter is unpriced, and the run total
                    becomes <code>null</code>.
                  </td>
                  <td className="dim">
                    <code>costcatch init</code> to refresh; gates fail closed meanwhile
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>stats</code> reads at most 2,000 traces
                  </td>
                  <td>Newest first, to keep the command fast as history grows.</td>
                  <td className="dim">
                    <code>clean</code> for retention
                  </td>
                </tr>
                <tr>
                  <td>Retry detection is a heuristic</td>
                  <td>Identical prompts, whatever the reason.</td>
                  <td className="dim">the wording reflects the uncertainty</td>
                </tr>
                <tr>
                  <td>Local only</td>
                  <td>No hosted dashboard, no team aggregation.</td>
                  <td className="dim">
                    <code>--json</code> on every read command feeds your own
                  </td>
                </tr>
                <tr>
                  <td>Not yet published to npm</td>
                  <td>
                    <code>release.yml</code> exists with provenance attestation; no tag has been
                    pushed.
                  </td>
                  <td className="dim">install from source, or npm link</td>
                </tr>
              </tbody>
            </table></div>
          </section>

          <section className="doc-sec" id="trace">
            <h2 className="doc-h1">Trace format</h2>
            <p className="doc-p">
              Saved runs are plain JSON files in <code>.costcatch/</code>, named{" "}
              <code>&lt;runId&gt;-&lt;script&gt;.json</code> — or <code>&lt;name&gt;.json</code> if
              you used <code>--save-as</code>. They are written so that only your own user account
              can read them.
            </p>
            <Cap id="traceFile" note="annotated" />

            <h3 className="doc-h2">The fields worth knowing</h3>
            <div className="tblwrap"><table className="tbl">
              <tbody>
                {TRACE_FIELDS.map(([field, body]) => (
                  <tr key={field}>
                    <td>
                      <code className="tok">{field}</code>
                    </td>
                    <td>{body}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="note">
              Providers disagree about what &quot;input tokens&quot; means: Anthropic leaves cached
              ones out of the number, OpenAI includes them. costcatch fixes that up as each response
              arrives, so inside a saved file <code>inputTokens</code> is always the full total and{" "}
              <code>cachedTokens</code> is always a part of it.
            </div>
          </section>

          <section className="doc-sec" id="warnings">
            <h2 className="doc-h1">Warning engine</h2>
            <p className="doc-p">
              Six checks, nothing to set up. They run on every saved run and stay quiet when there
              is nothing worth saying.
            </p>
            <div className="tblwrap"><table className="tbl">
              <thead>
                <tr>
                  <th>code</th>
                  <th>severity</th>
                  <th>fires when</th>
                </tr>
              </thead>
              <tbody>
                {WARNINGS.map(([code, sev, body]) => (
                  <tr key={code}>
                    <td>
                      <code className="warn">{code}</code>
                    </td>
                    <td className="dim">{sev}</td>
                    <td>{body}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="note">
              <b>&quot;Slow&quot; is worked out from the run itself.</b> Each call is compared to
              the middle of the <em>other</em>{" "}
              calls rather than to a fixed number of seconds, so a model that is slow the whole way
              through triggers nothing at all. Leaving the call itself out of that middle matters,
              because otherwise a hang would hide itself: one 60s call next to one 2s call averages
              out to 31s, and 60 is less than 31 × 2.5. Failed calls are left out too, so a burst of
              fast rate-limit errors cannot drag the number down towards zero.
            </div>
          </section>

          <section className="doc-sec" id="errors">
            <h2 className="doc-h1">Error paths</h2>
            <p className="doc-p">
              A good error message is a feature. Each of these says what was tried, what the rule
              is, and what to do instead.
            </p>

            <h3 className="doc-h2">An unsupported runtime</h3>
            <Cap id="errRuntime" />
            <p className="doc-p">
              bun and deno are refused <em>on purpose</em>. Neither supports the hook costcatch
              needs, so it would attach itself and then record nothing at all — and quietly
              recording nothing is worse than refusing to start.
            </p>

            <h3 className="doc-h2">A mistyped provider name</h3>
            <Cap id="errFilter" />
            <p className="doc-p">
              A mistyped <code>--filter</code>{" "}
              would otherwise hide every call and report a perfectly believable empty run — which
              reads as &quot;my agent never called a model&quot;. Checking the name against the
              real list turns a quiet wrong answer into a loud one.
            </p>

            <h3 className="doc-h2">No calls captured</h3>
            <Cap id="errNoCalls" />

            <h3 className="doc-h2">Filtered to a provider that was not called</h3>
            <Cap id="errFilterUnused" />
            <p className="doc-p">
              The filter is applied while the run is being recorded, so at this point costcatch
              genuinely does not know whether other providers were called. Saying &quot;no calls
              found&quot; would be a lie; saying &quot;calls were hidden&quot; would be a guess. So
              it says what the option does, and tells you how to find out.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
