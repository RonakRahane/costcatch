"use client";

import Link from "next/link";
import { useState } from "react";

export default function Close() {
  const [copied, setCopied] = useState(false);
  const cmd = "npm install -g costcatch";

  const copy = () => {
    navigator.clipboard?.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <section className="band" id="start">
      <div className="canvas close">
        <div className="label">
          <span className="sig" aria-hidden />
          get started
        </div>

        <div className="close-mark">
          costcatch<span className="dot">.</span>
        </div>

        <div className="close-rule" />

        <p className="close-line">Install it once, then put it in front of any agent.</p>

        <div className="close-actions">
          <button className="copybox" onClick={copy} aria-label={`Copy: ${cmd}`}>
            <span className="money" aria-hidden>
              $
            </span>
            <code>{cmd}</code>
            <span className={`cue${copied ? " done" : ""}`}>{copied ? "copied" : "copy"}</span>
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

        <div className="terms">
          {["no code changes", "no account", "nothing leaves your machine", "MIT licensed"].map((t) => (
            <span key={t}>
              <span className="ok" aria-hidden>
                ✓
              </span>
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
