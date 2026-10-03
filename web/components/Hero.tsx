"use client";

import Link from "next/link";
import { useState } from "react";
import Verbatim from "./Verbatim";
import { SITE_CAPTURES } from "@/data/site-captures";

const INSTALL = "npm install -g costcatch";

const SPECS: [string, string][] = [
  ["works with", "Python, Node"],
  ["providers", "10, auto-detected"],
  ["models priced", "5,000+ after init"],
  ["code changes", "none"],
  ["account", "none"],
  ["your data", "stays local"],
];

export default function Hero() {
  const [copied, setCopied] = useState(false);
  const init = SITE_CAPTURES.init;

  const copy = () => {
    navigator.clipboard?.writeText(INSTALL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <section className="hero band" id="top">
      <div className="canvas">
        <div className="plate">
          <div className="plate-rail">
            <div className="plate-no">01</div>
            <div className="plate-name">overview</div>
          </div>

          <div className="plate-body hero-body">
            <div className="hero-top">
              <div className="hero-copy">
                <div className="label on rise">
                  <span className="sig" aria-hidden />
                  KNOW YOUR COST - for python and node agents
                </div>

                <h1 className="h1 hero-h1 rise" style={{ "--d": "70ms" } as React.CSSProperties}>
                  See what your agent did and <span className="m">what it cost</span>.
                </h1>

                <p className="lede hero-lede rise" style={{ "--d": "140ms" } as React.CSSProperties}>
                  Put <code>costcatch</code> in front of the command that runs your agent. See every
                  LLM call it makes, what each call cost, and what went wrong.
                </p>

                <div className="hero-actions rise" style={{ "--d": "210ms" } as React.CSSProperties}>
                  <button className="copybox" onClick={copy} aria-label={`Copy: ${INSTALL}`}>
                    <span className="money" aria-hidden>
                      $
                    </span>
                    <code>{INSTALL}</code>
                    <span className={`cue${copied ? " done" : ""}`}>
                      {copied ? "copied" : "copy"}
                    </span>
                  </button>
                  <Link className="btn" href="/docs">
                    Docs
                  </Link>
                  <a
                    className="btn"
                    href="https://github.com/RonakRahane/costcatch"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub <span aria-hidden>↗</span>
                  </a>
                </div>
              </div>

              <dl className="specs rise" style={{ "--d": "280ms" } as React.CSSProperties}>
                {SPECS.map(([k, v]) => (
                  <div className="spec" key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="hero-figure rise" style={{ "--d": "340ms" } as React.CSSProperties}>
              <Verbatim command={init.command} output={init.output} exitCode={init.exitCode} note="first run" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
