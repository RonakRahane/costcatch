"use client";

import { useState } from "react";
import { Copy, Check, Terminal, Cpu, Sparkles } from "lucide-react";

export default function Colophon() {
  const [copied, setCopied] = useState(false);
  const command = "npm install -g costcatch && costcatch python agent.py";

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const providers = [
    "OpenAI (GPT-4o, o3-mini)",
    "Anthropic (Claude 3.7)",
    "Google Gemini 2.5",
    "DeepSeek R1 / V3",
    "Ollama (Local Models)",
    "Groq / Together / Mistral",
  ];

  return (
    <section id="colophon" className="py-16 bg-[#090a0f] font-mono border-b border-white/10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
          
          <div className="md:col-span-3 text-xs tracking-widest uppercase text-blue-400 font-bold">
            COLOPHON & QUICKSTART
          </div>

          <div className="md:col-span-9 space-y-6">
            <p className="text-sm text-slate-300 leading-relaxed">
              <strong className="text-white">agent-trace (costcatch)</strong> is entirely open source on GitHub. Run it on your own machine without sending your prompts or API credentials to any third party. Zero signups, zero telemetry, zero friction.
            </p>

            {/* Interactive Command Copy Box matching image 4 style */}
            <div className="relative bg-slate-950 p-4 rounded-lg border border-slate-800 flex items-center justify-between group hover:border-blue-500/50 transition-colors">
              <div className="flex items-center space-x-3 text-xs sm:text-sm font-mono overflow-x-auto text-blue-400">
                <span className="text-emerald-400 font-bold">$</span>
                <span className="text-slate-100">{command}</span>
              </div>

              <button
                onClick={handleCopy}
                className="ml-4 flex items-center space-x-1 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white px-3 py-1.5 rounded text-xs border border-slate-700 transition-all shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copied!" : "Copy"}</span>
              </button>
            </div>

            {/* Provider Grid */}
            <div className="pt-4 border-t border-slate-800">
              <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-3 flex items-center space-x-2">
                <Cpu className="w-3.5 h-3.5 text-blue-400" />
                <span>SUPPORTED PROVIDERS & APIS</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {providers.map((p, idx) => (
                  <div key={idx} className="bg-slate-900/60 px-3 py-1.5 rounded text-xs text-slate-300 border border-slate-800/80 flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>
      </div>
    </section>
  );
}
