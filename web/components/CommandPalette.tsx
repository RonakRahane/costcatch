"use client";

import { useState, useEffect } from "react";
import { Search, X, Terminal, Copy, Check, ArrowRight } from "lucide-react";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) onClose();
      }
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const commandsList = [
    { cmd: "agent-trace run -- python main.py", desc: "Run agent with live terminal tracer dashboard" },
    { cmd: "agent-trace show --last", desc: "Inspect detailed payload & tool calls of most recent run" },
    { cmd: "agent-trace diff --compare=last", desc: "View auto-diff of system prompts & model responses" },
    { cmd: "agent-trace stats --days=30", desc: "View aggregate token spend, costs, and model latency" },
    { cmd: "agent-trace watch", desc: "Launch live TUI dashboard to monitor ongoing agent runs" },
    { cmd: "agent-trace init", desc: "Initialize local config & cost assertion rules in project" },
  ];

  const filtered = commandsList.filter(
    (c) => c.cmd.toLowerCase().includes(query.toLowerCase()) || c.cmd.toLowerCase().includes(query.toLowerCase())
  );

  const copyCommand = (cmdText: string) => {
    navigator.clipboard.writeText(cmdText);
    setCopiedCmd(cmdText);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-20 px-4 font-mono">
      <div className="bg-[#0c0d12] border border-slate-800 rounded-xl max-w-xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Search Input Bar */}
        <div className="p-4 border-b border-slate-800 flex items-center space-x-3 bg-slate-950">
          <Search className="w-4 h-4 text-blue-400 shrink-0" />
          <input
            type="text"
            placeholder="Search CLI commands, options, or docs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
          />
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Commands Result List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No matching commands found.
            </div>
          ) : (
            filtered.map((item, idx) => (
              <div
                key={idx}
                onClick={() => copyCommand(item.cmd)}
                className="group p-3 rounded-lg hover:bg-slate-900 border border-transparent hover:border-slate-800 flex items-center justify-between cursor-pointer transition-all"
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2 text-xs font-bold text-blue-400 group-hover:text-blue-300">
                    <Terminal className="w-3.5 h-3.5" />
                    <span>{item.cmd}</span>
                  </div>
                  <div className="text-[11px] text-slate-400">{item.desc}</div>
                </div>

                <div className="text-slate-500 group-hover:text-white transition-colors">
                  {copiedCmd === item.cmd ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950 text-[10px] text-slate-500 flex items-center justify-between">
          <span>Click command to copy to clipboard</span>
          <kbd className="bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded text-slate-400">ESC to close</kbd>
        </div>

      </div>
    </div>
  );
}
