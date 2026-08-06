"use client";

import { CheckCircle2, Shield, Zap, Lock, Database } from "lucide-react";

export default function StatsSection() {
  const stats = [
    { label: "PASSED UNIT TESTS", value: "131 / 131", percentage: 100, color: "bg-blue-600" },
    { label: "ZERO-INSTRUMENTATION", value: "0 CODE CHANGES", percentage: 100, color: "bg-emerald-500" },
    { label: "LOCAL DATA PRIVACY", value: "100% ON-DEVICE", percentage: 100, color: "bg-purple-600" },
    { label: "SUPPORTED LANGUAGES", value: "PYTHON, NODE, RUST, GO", percentage: 100, color: "bg-cyan-500" },
  ];

  const highlights = [
    {
      title: "Zero SDK Lock-In",
      desc: "Intercepts at the HTTP socket level. Never worry about SDK breaking changes or proxy servers.",
      icon: Zap,
    },
    {
      title: "Local SQLite Storage",
      desc: "Traces and token logs stay entirely inside your `.costcatch` workspace directory.",
      icon: Database,
    },
    {
      title: "Secret & PII Shield",
      desc: "Automatic regex masks for OPENAI_API_KEY, ANTHROPIC_API_KEY, passwords, and tokens.",
      icon: Lock,
    },
    {
      title: "CI Assertion Gates",
      desc: "Set max cost thresholds (e.g. `$cost <= 0.05`) to fail GitHub Action builds automatically.",
      icon: Shield,
    },
  ];

  return (
    <section id="how-it-works" className="py-16 border-t border-b border-white/10 bg-[#090a0f] relative font-mono">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        
        {/* Editorial "HOW THIS WORKS" Section matching image 2 & 3 layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start mb-16">
          <div className="md:col-span-3 text-xs tracking-widest uppercase text-blue-400 font-bold">
            HOW THIS WORKS
          </div>

          <div className="md:col-span-9 grid grid-cols-1 sm:grid-cols-2 gap-8 text-sm text-slate-300 leading-relaxed">
            <div>
              <p className="first-letter:float-left first-letter:text-5xl first-letter:font-bold first-letter:mr-3 first-letter:text-blue-500 first-letter:leading-none">
                M
                ost LLM tracing tools demand SDK imports, cloud signups, or custom proxy setups.
                Every time your SDK updates, your trace integration breaks. You hand over your sensitive prompt data to third-party servers just to see your token spend.
              </p>
            </div>

            <div>
              <p>
                <strong className="text-white">agent-trace is different.</strong> It runs like Unix <code className="text-blue-400 bg-slate-900 px-1 py-0.5 rounded">time</code>. By wrapping your process, it monitors raw HTTP traffic, calculates exact pricing for Claude 3.7, GPT-4o, DeepSeek R1, Gemini 2.5, and renders live terminal updates without adding latency.
              </p>
            </div>
          </div>
        </div>

        {/* Progress Metrics Section */}
        <div className="border-t border-slate-800 pt-12">
          <div className="text-xs tracking-widest uppercase text-blue-400 font-bold mb-6">
            CURRENT PROGRESS & SUITE METRICS
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {stats.map((s, idx) => (
              <div key={idx} className="bg-slate-950 p-4 rounded border border-slate-800 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-bold">{s.label}</span>
                  <span className="text-white font-bold">{s.value}</span>
                </div>
                <div className="w-full bg-slate-900 h-3 rounded overflow-hidden p-0.5 flex">
                  <div className={`h-full ${s.color} rounded transition-all duration-1000`} style={{ width: `${s.percentage}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Feature Cards Grid */}
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {highlights.map((h, idx) => {
            const IconComponent = h.icon;
            return (
              <div key={idx} className="bg-slate-950/60 p-5 rounded-lg border border-slate-800 hover:border-blue-500/50 transition-all group">
                <div className="w-8 h-8 rounded bg-blue-950/60 border border-blue-500/30 flex items-center justify-center text-blue-400 mb-3 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <IconComponent className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-white mb-1.5">{h.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{h.desc}</p>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
