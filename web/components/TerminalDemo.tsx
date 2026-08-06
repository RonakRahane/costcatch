"use client";

import { useState, useEffect } from "react";
import { Play, Pause, RotateCcw, Copy, Check, Terminal, ShieldAlert, Sparkles, Code, FileText, Activity } from "lucide-react";

interface CallItem {
  id: number;
  model: string;
  duration: string;
  inputTokens: number;
  outputTokens: number;
  cost: string;
  status: "done" | "running" | "warning";
  toolCall?: string;
  warning?: string;
  promptSnippet?: string;
  responseSnippet?: string;
}

export default function TerminalDemo() {
  const [isPlaying, setIsPlaying] = useState(true);
  const [step, setStep] = useState(3);
  const [copied, setCopied] = useState(false);
  const [selectedCall, setSelectedCall] = useState<CallItem | null>(null);
  const [activeTab, setActiveTab] = useState<"terminal" | "autodiff" | "inspection">("terminal");

  const callsData: CallItem[] = [
    {
      id: 1,
      model: "claude-sonnet-4-6",
      duration: "0.8s",
      inputTokens: 1203,
      outputTokens: 87,
      cost: "$0.004",
      status: "done",
      toolCall: '⚡ web_search("Tesla Q4 2024 financial earnings & revenue")',
      promptSnippet: "Find the latest Q4 2024 revenue numbers for Tesla.",
      responseSnippet: 'Found tool match. Executing search query "Tesla Q4 2024 revenue".',
    },
    {
      id: 2,
      model: "claude-sonnet-4-6",
      duration: "1.4s",
      inputTokens: 5891,
      outputTokens: 92,
      cost: "$0.019",
      status: "warning",
      warning: "⚠ context grew 4.9× (1,203 → 5,891 tok)",
      toolCall: '⚡ python_exec("calc_net_income(25.17B, 2.1B)")',
      promptSnippet: "System Prompt + Search Results (15 pages context loaded)...",
      responseSnippet: "Calculating operating income metrics from raw search table.",
    },
    {
      id: 3,
      model: "gpt-4o",
      duration: "2.3s",
      inputTokens: 8940,
      outputTokens: 412,
      cost: "$0.028",
      status: "done",
      toolCall: "⚡ generate_summary_report()",
      promptSnippet: "Synthesize findings into executive financial summary.",
      responseSnippet: "Tesla recorded $25.17B in Q4 revenue with 17.6% automotive margin.",
    },
  ];

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setStep((prev) => (prev >= callsData.length ? 1 : prev + 1));
    }, 3500);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const handleCopy = () => {
    navigator.clipboard.writeText("npx agent-trace python my_agent.py");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const visibleCalls = callsData.slice(0, step);
  const totalCost = visibleCalls.reduce((acc, c) => acc + parseFloat(c.cost.replace("$", "")), 0).toFixed(3);
  const totalTokensIn = visibleCalls.reduce((acc, c) => acc + c.inputTokens, 0);
  const totalTokensOut = visibleCalls.reduce((acc, c) => acc + c.outputTokens, 0);

  return (
    <section id="demo" className="py-12 relative max-w-5xl mx-auto px-4 sm:px-6">
      {/* Glow aura */}
      <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-blue-500/10 blur-3xl pointer-events-none -z-10" />

      {/* Control bar above terminal */}
      <div className="flex items-center justify-between mb-3 text-xs font-mono text-slate-400">
        <div className="flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-blue-400" />
          <span className="font-semibold text-slate-200">LIVE TERMINAL DASHBOARD</span>
          <span className="hidden sm:inline bg-slate-900 border border-slate-800 text-blue-400 px-2 py-0.5 rounded text-[10px]">
            ZERO CODE CHANGES REQUIRED
          </span>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="flex items-center space-x-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 px-2.5 py-1 rounded text-slate-300 hover:text-white transition-colors"
          >
            {isPlaying ? <Pause className="w-3 h-3 text-amber-400" /> : <Play className="w-3 h-3 text-emerald-400" />}
            <span>{isPlaying ? "Pause" : "Play Live"}</span>
          </button>

          <button
            onClick={() => setStep(1)}
            className="p-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-400 hover:text-white transition-colors"
            title="Reset Simulation"
          >
            <RotateCcw className="w-3 h-3" />
          </button>

          <button
            onClick={handleCopy}
            className="flex items-center space-x-1 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 px-2.5 py-1 rounded text-xs transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? "Copied!" : "agent-trace run"}</span>
          </button>
        </div>
      </div>

      {/* Terminal Container */}
      <div className="rounded-xl border border-slate-800 bg-[#0c0d12] shadow-2xl overflow-hidden font-mono text-xs sm:text-sm">
        {/* Terminal Header */}
        <div className="bg-[#12141c] px-4 py-3 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-green-500/80 inline-block" />
            <span className="ml-3 text-slate-400 text-xs truncate">bash — 80×24</span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveTab("terminal")}
              className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
                activeTab === "terminal" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Trace View
            </button>
            <button
              onClick={() => setActiveTab("autodiff")}
              className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
                activeTab === "autodiff" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Prompt Diff
            </button>
            <button
              onClick={() => setActiveTab("inspection")}
              className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
                activeTab === "inspection" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Payload
            </button>
          </div>
        </div>

        {/* Terminal Body */}
        {activeTab === "terminal" && (
          <div className="p-4 sm:p-6 space-y-4 min-h-[360px] bg-[#090a0f] text-slate-200">
            {/* Command Input Prompt */}
            <div className="flex items-center space-x-2 text-slate-400 border-b border-slate-800/60 pb-3">
              <span className="text-emerald-400 font-bold">$</span>
              <span className="text-slate-100 font-bold">agent-trace</span>
              <span className="text-blue-400">python</span>
              <span className="text-slate-300">finance_agent.py --mode=full</span>
            </div>

            {/* Standard Output snippet */}
            <div className="text-slate-500 text-xs italic space-y-1">
              <div>[INFO] Loading LLM Agent dependencies...</div>
              <div>[INFO] Intercepting HTTP outbound sockets at localhost:8080</div>
              <div>[INFO] Agent started processing task: "Tesla Financial Overview"</div>
            </div>

            {/* Live Box Trace */}
            <div className="rounded-lg border border-blue-500/30 bg-blue-950/20 p-4 space-y-3 font-mono">
              <div className="flex items-center justify-between text-blue-400 font-bold border-b border-blue-500/20 pb-2 text-xs sm:text-sm">
                <span>╭─ ⚡ agent-trace ─────────────────────────────</span>
                <span>⧗ 18.3s &nbsp; ${totalCost} ─╮</span>
              </div>

              {/* Calls Tree */}
              <div className="space-y-3 pl-2 sm:pl-4">
                {visibleCalls.map((call) => (
                  <div
                    key={call.id}
                    onClick={() => setSelectedCall(call)}
                    className="group cursor-pointer hover:bg-white/5 p-2 rounded transition-colors border border-transparent hover:border-slate-800"
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2 text-xs sm:text-sm">
                      <div className="flex items-center space-x-2">
                        <span className="text-emerald-400 font-bold">✓</span>
                        <span className="bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                          #{call.id}
                        </span>
                        <span className="text-slate-100 font-semibold">{call.model}</span>
                      </div>

                      <div className="flex items-center space-x-3 text-xs text-slate-400">
                        <span>{call.duration}</span>
                        <span className="text-slate-500">
                          {call.inputTokens.toLocaleString()} → {call.outputTokens} tok
                        </span>
                        <span className="text-emerald-400 font-bold">{call.cost}</span>
                      </div>
                    </div>

                    {/* Tool Call subnode */}
                    {call.toolCall && (
                      <div className="mt-1.5 pl-6 text-xs text-blue-300 flex items-center space-x-1">
                        <span className="text-slate-600">└─</span>
                        <span className="font-mono text-cyan-400">{call.toolCall}</span>
                      </div>
                    )}

                    {/* Warning tag if any */}
                    {call.warning && (
                      <div className="mt-1.5 pl-6 text-xs text-amber-400 flex items-center space-x-1 font-semibold">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>{call.warning}</span>
                      </div>
                    )}
                  </div>
                ))}

                {step < callsData.length && (
                  <div className="flex items-center space-x-2 text-blue-400 animate-pulse pl-2 py-1">
                    <span className="text-xs">⠹ ·· gpt-4o 2.3s thinking…</span>
                  </div>
                )}
              </div>

              {/* Summary Footer Box */}
              <div className="border-t border-blue-500/20 pt-3 text-xs text-slate-400 space-y-1">
                <div className="flex justify-between items-center text-slate-300 font-semibold">
                  <span>
                    {visibleCalls.length} LLM calls &nbsp;·&nbsp; 2 tool calls &nbsp;·&nbsp; 18.3s &nbsp;·&nbsp; ${totalCost}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-500 text-[11px]">
                  <span>
                    {(totalTokensIn / 1000).toFixed(1)}k → {totalTokensOut} tok &nbsp;·&nbsp; at 100 runs/day = ${(
                      parseFloat(totalCost) * 100 * 30
                    ).toFixed(0)}/mo
                  </span>
                  <span className="text-blue-400">╰─ 3 calls · $0.21 ─────────────╯</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Prompt Auto-Diff View */}
        {activeTab === "autodiff" && (
          <div className="p-6 min-h-[360px] bg-[#090a0f] space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-slate-400">
              <span className="text-blue-400 font-bold">AUTO-DIFF BETWEEN RUN #1 AND RUN #2</span>
              <span>-12 lines, +18 lines changed</span>
            </div>

            <div className="space-y-1 bg-slate-950 p-4 rounded border border-slate-800 leading-relaxed overflow-x-auto">
              <div className="text-slate-500">@@ -14,7 +14,12 @@ System Prompt Instructions</div>
              <div className="text-red-400 bg-red-950/30 px-2 py-0.5 rounded">
                - You are a generic financial reporting bot. Answer briefly.
              </div>
              <div className="text-emerald-400 bg-emerald-950/30 px-2 py-0.5 rounded">
                + You are a senior equity analyst. Summarize net profit, margins, and EPS guidance.
              </div>
              <div className="text-slate-400 px-2"> Include breakdown of automotive vs energy revenue streams.</div>
              <div className="text-emerald-400 bg-emerald-950/30 px-2 py-0.5 rounded">
                + Return structured JSON matching schema: {"{ revenue: number, margin: number }"}.
              </div>
            </div>

            <div className="text-slate-400 text-xs flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-yellow-400" />
              <span>Prompt change reduced output tokens by 34% and improved schema accuracy!</span>
            </div>
          </div>
        )}

        {/* JSON Payload Inspection */}
        {activeTab === "inspection" && (
          <div className="p-6 min-h-[360px] bg-[#090a0f] space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-slate-400">
              <span className="text-emerald-400 font-bold">RAW HTTP PAYLOAD INSPECTION (#2)</span>
              <span className="text-slate-500">Redacted 2 Secrets / API Keys</span>
            </div>

            <pre className="p-4 bg-slate-950 rounded border border-slate-800 text-slate-300 overflow-x-auto text-[11px] leading-relaxed">
{`{
  "provider": "anthropic",
  "endpoint": "https://api.anthropic.com/v1/messages",
  "model": "claude-sonnet-4-6",
  "max_tokens": 1024,
  "redacted_headers": {
    "x-api-key": "[REDACTED_SECRET_KEY]"
  },
  "usage": {
    "input_tokens": 5891,
    "output_tokens": 92,
    "calculated_cost_usd": 0.019
  },
  "tools_invoked": [
    "python_exec"
  ]
}`}
            </pre>
          </div>
        )}
      </div>

      {/* Selected Call Detail Modal */}
      {selectedCall && (
        <div className="mt-4 p-4 rounded-lg bg-slate-900/90 border border-slate-700 text-xs font-mono flex items-start justify-between">
          <div>
            <div className="text-blue-400 font-bold mb-1">SELECTED CALL INSPECION: #{selectedCall.id}</div>
            <div className="text-slate-300">Prompt: "{selectedCall.promptSnippet}"</div>
            <div className="text-emerald-400 mt-1">Response: "{selectedCall.responseSnippet}"</div>
          </div>
          <button
            onClick={() => setSelectedCall(null)}
            className="text-slate-500 hover:text-slate-200 text-xs underline ml-4"
          >
            Close
          </button>
        </div>
      )}
    </section>
  );
}
