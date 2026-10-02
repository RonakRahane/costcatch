"use client";

// The takeaways quote figures from data/site-captures.ts, so update them when the captures change.

import { useState } from "react";
import Verbatim from "./Verbatim";
import { RUN_WARNINGS, SITE_CAPTURES, type SiteCaptureId } from "@/data/site-captures";

type Cmd = {
  id: SiteCaptureId;
  label: string;
  hint: string;
  takeaway: React.ReactNode;
};

const COMMANDS: Cmd[] = [
  {
    id: "run",
    label: "run",
    hint: "trace a command",
    takeaway: (
      <>
        Six calls and eight warnings, for <span className="money">$0.08</span>. At 1,000 runs a
        day, this agent would cost <span className="money">$2,525</span> a month.
      </>
    ),
  },
  {
    id: "show",
    label: "show",
    hint: "read what the model saw",
    takeaway: (
      <>
        One step in full: the prompt, the reply and each tool call. The log file came back as
        ~5.2k tokens, and that result went out in 5 requests.
      </>
    ),
  },
  {
    id: "diff",
    label: "diff",
    hint: "compare two runs",
    takeaway: (
      <>
        The same agent after the fix: 3 calls instead of 6, and{" "}
        <span className="money">81% cheaper</span>.
      </>
    ),
  },
  {
    id: "stats",
    label: "stats",
    hint: "add up every run",
    takeaway: (
      <>
        Every saved run, totalled by script, model and tool. One tool, read_file, put ~27k tokens
        into prompts.
      </>
    ),
  },
  {
    id: "estimate",
    label: "estimate",
    hint: "price a prompt first",
    takeaway: (
      <>
        A prompt priced on three models before you send it. Here, Gemini 2.5 Flash costs 91% less
        than Claude Sonnet 4.
      </>
    ),
  },
  {
    id: "watch",
    label: "watch",
    hint: "run and always save",
    takeaway: <>A traced run that is always saved, so you can come back to it later.</>,
  },
  {
    id: "replay",
    label: "replay",
    hint: "show a saved run again",
    takeaway: <>Shows a saved run again. No API call, no cost.</>,
  },
  {
    id: "clean",
    label: "clean",
    hint: "delete old runs",
    takeaway: (
      <>
        Keeps your newest runs and deletes the rest. <code>--dry-run</code> shows what would go
        first.
      </>
    ),
  },
  {
    id: "init",
    label: "init",
    hint: "set up a project",
    takeaway: (
      <>
        Creates <code>.costcatch/</code>, adds it to <code>.gitignore</code> and fetches current
        prices for 5,000+ models. Add <code>--offline</code> to skip the download.
      </>
    ),
  },
];

export function ConsoleWindow() {
  const [active, setActive] = useState(0);
  const cmd = COMMANDS[active];
  const capture = SITE_CAPTURES[cmd.id];

  return (
    <div className="framed">
      <div className="console">
        <div className="console-bar">
          <span className="sig" aria-hidden />
          <span className="path">~/oncall-agent</span>
          <span className="spacer" />
          <span>costcatch v0.1.0</span>
        </div>

        <div className="console-grid">
          <aside className="rail" aria-label="Commands">
            <div className="rail-label">commands</div>
            {COMMANDS.map((c, i) => (
              <button
                key={c.label}
                className={`rail-item${i === active ? " on" : ""}`}
                onClick={() => setActive(i)}
                aria-pressed={i === active}
              >
                <span className="rail-name">{c.label}</span>
                <span className="rail-hint">{c.hint}</span>
              </button>
            ))}
          </aside>

          <div className="work">
            <div className="work-take">{cmd.takeaway}</div>
            <div className="work-out work-verbatim">
              <Verbatim
                command={capture.command}
                output={capture.output}
                exitCode={capture.exitCode}
                severities={cmd.id === "run" ? RUN_WARNINGS.map((w) => w.severity) : undefined}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Console() {
  return (
    <section className="band" id="commands">
      <div className="canvas">
        <div className="plate">
          <div className="plate-rail">
            <div className="plate-no">04</div>
            <div className="plate-name">commands</div>
          </div>

          <div className="plate-body">
            <h2 className="h2">
              Find out why. <em>Then prove the fix.</em>
            </h2>

            <p className="lede">
              Save a run with <code>--save</code>. Then read what the model saw, compare two runs,
              or add them all up.
            </p>

            <ConsoleWindow />
          </div>
        </div>
      </div>
    </section>
  );
}
