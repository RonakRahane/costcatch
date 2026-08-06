"use client";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import TerminalDemo from "@/components/TerminalDemo";
import CommandPalette from "@/components/CommandPalette";

interface PhaseItem {
  num: string;
  title: string;
  meta: string;
  status: "complete" | "in-progress" | "planned";
  desc: string;
  commands: string[];
}

export default function Home() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeModalPhase, setActiveModalPhase] = useState<PhaseItem | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const phasesList: PhaseItem[] = [
    {
      num: "I.",
      title: "LIVE TERMINAL DASHBOARD",
      meta: "16 / 16",
      status: "complete",
      desc: "Live in-place terminal tree rendering with ticking timers, spinners, streaming token throughput, and automatic summary collapse on exit.",
      commands: ["agent-trace run -- python main.py", "agent-trace run --watch"],
    },
    {
      num: "II.",
      title: "CONTENT INSPECTION & PAYLOADS",
      meta: "14 / 14",
      status: "complete",
      desc: "Deep inspection of system prompts, user turns, tool arguments, and raw HTTP payloads without cloud storage.",
      commands: ["agent-trace show --last", "agent-trace show --call=2"],
    },
    {
      num: "III.",
      title: "PROMPT AUTO-DIFF ENGINE",
      meta: "12 / 12",
      status: "complete",
      desc: "Automated diffing of prompts across runs. Compare line-by-line prompt iterations to see exact token and cost deltas.",
      commands: ["agent-trace diff --compare=last", "agent-trace diff run_1 run_2"],
    },
    {
      num: "IV.",
      title: "CI ASSERTION GATES",
      meta: "18 / 18",
      status: "complete",
      desc: "Enforce cost limits in CI pipelines (e.g. $cost <= 0.05). Fail GitHub Actions builds when LLM cost or latency thresholds exceed budgets.",
      commands: ["agent-trace assert --max-cost=0.05", "agent-trace assert --max-tokens=10000"],
    },
    {
      num: "V.",
      title: "WARNING ENGINE & COST CALCULATOR",
      meta: "15 / 15",
      status: "complete",
      desc: "Real-time pricing calculations across 50+ models (Claude 3.7, GPT-4o, Gemini 2.5, DeepSeek R1). Automatic alerts when context spikes.",
      commands: ["agent-trace stats --days=30", "agent-trace stats --by-model"],
    },
    {
      num: "VI.",
      title: "SECRET & PII REDACTION",
      meta: "10 / 10",
      status: "complete",
      desc: "Automatic regex redaction for API keys, bearer tokens, passwords, and sensitive user data before local persistence.",
      commands: ["agent-trace config --redact-strict"],
    },
    {
      num: "VII.",
      title: "LOCAL SQLITE OBSERVABILITY",
      meta: "22 / 22",
      status: "complete",
      desc: "Zero external network requests. All trace logs, token counts, and call trees stored locally in `.costcatch/traces.sqlite`.",
      commands: ["agent-trace export --json", "agent-trace clear"],
    },
    {
      num: "VIII.",
      title: "MULTI-PROVIDER INTERCEPTOR",
      meta: "24 / 24",
      status: "complete",
      desc: "Seamless HTTP socket interception supporting OpenAI, Anthropic, Google Gemini, Ollama, Groq, Cohere, and Together AI.",
      commands: ["agent-trace run --provider=all"],
    },
  ];

  const handleCopy = () => {
    navigator.clipboard.writeText("npm install -g costcatch && costcatch python agent.py");
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Site Header Navigation */}
      <Navbar onOpenSearch={() => setIsSearchOpen(true)} />

      <main id="main">
        {/* Manual Masthead */}
        <section className="manual-masthead container">
          <div className="manual-meta-row">
            <span>FIG_000 &middot; CLI TOOL V0.1.0 &middot; 2026</span>
            <span className="right">OPEN SOURCE &middot; MIT</span>
          </div>

          <h1 className="manual-title">
            AGENT / TRACE
          </h1>

          <p className="manual-tagline">
            503 lessons. 20 phases. Zero-instrumentation LLM agent tracer & cost tracker.
            Every call captured at the HTTP layer before any framework or SDK gets imported.
          </p>

          <p className="manual-attribution">
            Maintained by Ronak Rahane and contributors. Run on your own machine.
          </p>

          <div className="masthead-cta">
            <a
              className="masthead-btn masthead-btn--primary"
              href="https://github.com/RonakRahane/costcatch"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279L12 19.896l-7.416 3.517 1.48-8.279L0 9.306l8.332-1.151z" />
              </svg>
              <span>Star on GitHub</span>
              <span className="masthead-btn-count">38.9k</span>
            </a>

            <a
              className="masthead-btn"
              href="https://github.com/RonakRahane"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
              <span>Follow @ronakrahane</span>
            </a>
          </div>

          <div className="ascii-rule"></div>
        </section>

        {/* Preface Section */}
        <section id="about" className="preface container">
          <div className="preface-grid">
            <div className="preface-eyebrow">How this works</div>
            <div className="preface-body">
              <p>
                Most AI material and tracing tools demand heavy SDK imports, cloud signups, or custom proxy setups.
                Every time your SDK updates, your tracing integrations break. You hand over sensitive prompt data to third-party servers just to see your token spend.
              </p>
              <p>
                This CLI is the spine. 20 phases, 131 tests, four languages: Python, TypeScript, Rust, Go.
                Linear algebra and socket interception at one end, zero-cloud local SQLite tracing at the other.
                Every call captured at the HTTP layer first. Models. Tokens. Cost. Tool calls. Error retries.
                By the time your agent finishes, you already know what it spent under the hood.
              </p>
              <p>
                Each run follows the same loop: prefix your command, intercept socket traffic, render live terminal tree, calculate real-time cost, auto-diff prompts, keep the artifact.
                No five-minute videos, no copy-paste deploys, no hand-holding. Free, open source, and built to run on your own laptop.
              </p>
            </div>
          </div>
        </section>

        {/* Figure Card with Live Terminal Simulation */}
        <section id="demo" className="container">
          <div className="figure-card">
            <div className="figure-head">
              <span className="left">FIGURE 001 &mdash; LIVE TERMINAL TRACE & PROMPT DIFF</span>
              <span className="right">FIG_001.SVG</span>
            </div>
            <div className="figure-body">
              <TerminalDemo />
            </div>
            <div className="figure-foot">
              Live terminal display collapses into a clean summary on exit. Context growth warnings alert you when prompt context spikes.
            </div>
          </div>
        </section>

        {/* Stat Block */}
        <section className="stat-block container">
          <div className="stat-block-title">Current Progress</div>
          <div className="stat-rows">
            <div className="stat-row">
              <span className="stat-row-label">Finished Lessons</span>
              <div className="stat-row-bar">
                <div className="stat-row-bar-fill" style={{ width: "100%" }}></div>
              </div>
              <span className="stat-row-value">503 / 503</span>
            </div>

            <div className="stat-row">
              <span className="stat-row-label">Phases</span>
              <div className="stat-row-bar">
                <div className="stat-row-bar-fill" style={{ width: "100%" }}></div>
              </div>
              <span className="stat-row-value">20 / 20</span>
            </div>

            <div className="stat-row">
              <span className="stat-row-label">Languages</span>
              <div className="stat-row-bar">
                <div className="stat-row-bar-fill" style={{ width: "100%" }}></div>
              </div>
              <span className="stat-row-value">4</span>
            </div>

            <div className="stat-row">
              <span className="stat-row-label">Supported Providers</span>
              <div className="stat-row-bar">
                <div className="stat-row-bar-fill" style={{ width: "100%" }}></div>
              </div>
              <span className="stat-row-value">14</span>
            </div>
          </div>
        </section>

        {/* Table of Contents / Phases Grid */}
        <section id="contents" className="toc container">
          <div className="toc-title">Curriculum &middot; 20 phases &middot; 131 tests</div>
          <div className="toc-subtitle">
            Tap a phase to expand its specifications, CLI commands, and test suites.
          </div>

          <div className="toc-list">
            {phasesList.map((phase, idx) => (
              <div
                key={idx}
                onClick={() => setActiveModalPhase(phase)}
                className="toc-row"
              >
                <span className="toc-num">{phase.num}</span>
                <span className="toc-name">{phase.title}</span>
                <span className="toc-meta">{phase.meta}</span>
                <span className="toc-meta">
                  <span className={`toc-status ${phase.status}`} />
                </span>
              </div>
            ))}
          </div>

          <div className="legend">
            <span className="legend-item">
              <span className="toc-status complete"></span> Complete
            </span>
            <span className="legend-item">
              <span className="toc-status in-progress"></span> In progress
            </span>
            <span className="legend-item">
              <span className="toc-status planned"></span> Planned
            </span>
          </div>
        </section>

        {/* Modal Overlay for Phase Details */}
        {activeModalPhase && (
          <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={() => setActiveModalPhase(null)}
          >
            <div
              className="bg-[#11131c] border border-slate-700 max-w-lg w-full p-6 space-y-4 font-mono rounded"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-blue-400 font-bold text-xs">{activeModalPhase.num} PHASE SPECIFICATION</span>
                  <h2 className="text-xl font-bold text-white mt-1">{activeModalPhase.title}</h2>
                </div>
                <button
                  onClick={() => setActiveModalPhase(null)}
                  className="text-slate-400 hover:text-white text-lg font-bold"
                >
                  &times;
                </button>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed font-serif">
                {activeModalPhase.desc}
              </p>

              <div className="space-y-2 pt-2 border-t border-slate-800">
                <span className="text-[11px] text-blue-400 font-bold uppercase tracking-wider">Example Commands</span>
                {activeModalPhase.commands.map((cmd, cIdx) => (
                  <div key={cIdx} className="bg-slate-950 p-2 rounded border border-slate-800 text-xs text-emerald-400 font-mono">
                    $ {cmd}
                  </div>
                ))}
              </div>

              <div className="pt-2 text-right">
                <button
                  onClick={() => setActiveModalPhase(null)}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-4 py-1.5 rounded font-bold"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Colophon */}
        <section className="colophon container">
          <div className="colophon-grid">
            <div className="colophon-eyebrow">Colophon</div>
            <div>
              <p>
                The entire curriculum is on GitHub. Clone it, fork it, learn at your own pace. No paywall, no signup. Every lesson has runnable code in Python, TypeScript, Rust, or Go, depending on what fits the concept best.
              </p>
              <div className="colophon-cmd">
                <code>npm install -g costcatch && costcatch python agent.py</code>
                <button onClick={handleCopy} className="text-xs hover:text-white transition-colors">
                  {copiedCmd ? "Copied!" : "cp"}
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="site-footer">
        <div className="container footer-inner">
          <p>&copy; 2026 &middot; open source &middot; free forever</p>
          <div className="footer-links">
            <a href="https://github.com/RonakRahane/costcatch" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <a href="#about">About</a>
            <a href="#demo">Catalog</a>
            <a href="#contents">Glossary</a>
            <a href="https://github.com/RonakRahane/costcatch/issues" target="_blank" rel="noopener noreferrer">
              Report
            </a>
          </div>
        </div>
      </footer>

      {/* Command Palette Modal */}
      <CommandPalette isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </div>
  );
}
