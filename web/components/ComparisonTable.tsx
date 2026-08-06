"use client";

import { Check, X, ShieldAlert } from "lucide-react";

export default function ComparisonTable() {
  const tools = [
    {
      name: "agent-trace",
      tax: "Zero Tax",
      codeChanges: true,
      localOnly: true,
      noAccount: true,
      httpLayer: true,
      badge: "RECOMMENDED",
      highlight: true,
    },
    {
      name: "LangSmith",
      tax: "Requires LangChain SDK",
      codeChanges: false,
      localOnly: false,
      noAccount: false,
      httpLayer: false,
    },
    {
      name: "Helicone",
      tax: "Requires Changing Proxy Base URL",
      codeChanges: false,
      localOnly: false,
      noAccount: false,
      httpLayer: false,
    },
    {
      name: "Langfuse",
      tax: "Cloud-first, Cloud API Key",
      codeChanges: false,
      localOnly: false,
      noAccount: false,
      httpLayer: false,
    },
    {
      name: "OpenTelemetry",
      tax: "Complex Custom Spans Setup",
      codeChanges: false,
      localOnly: true,
      noAccount: true,
      httpLayer: false,
    },
    {
      name: "Datadog LLM",
      tax: "Enterprise Pricing & Overhead",
      codeChanges: false,
      localOnly: false,
      noAccount: false,
      httpLayer: false,
    },
  ];

  return (
    <section id="comparison" className="py-16 bg-[#090a0f] font-mono border-b border-white/10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-blue-400 font-bold mb-1">
              ZERO-TAX ARCHITECTURE
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white">
              Why Engineers Choose agent-trace
            </h2>
          </div>
          <div className="text-xs text-slate-400">
            No vendor lock-in. No proxy latency. No secret key leaks.
          </div>
        </div>

        {/* Table Container */}
        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400 uppercase tracking-wider">
                <th className="py-3.5 px-4 font-bold">Tool</th>
                <th className="py-3.5 px-4 font-bold">Integration Tax</th>
                <th className="py-3.5 px-4 font-bold text-center">Zero Code Changes</th>
                <th className="py-3.5 px-4 font-bold text-center">100% Local Data</th>
                <th className="py-3.5 px-4 font-bold text-center">No Account Needed</th>
                <th className="py-3.5 px-4 font-bold text-center">HTTP Layer Intercept</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-slate-300">
              {tools.map((t, idx) => (
                <tr
                  key={idx}
                  className={`transition-colors ${
                    t.highlight ? "bg-blue-950/20 text-white font-semibold" : "hover:bg-slate-900/40"
                  }`}
                >
                  <td className="py-4 px-4 flex items-center space-x-2">
                    <span className="font-bold">{t.name}</span>
                    {t.badge && (
                      <span className="bg-blue-600 text-white text-[9px] px-1.5 py-0.5 rounded font-bold">
                        {t.badge}
                      </span>
                    )}
                  </td>

                  <td className="py-4 px-4 text-slate-400">
                    <span className={t.highlight ? "text-emerald-400 font-bold" : "text-slate-400"}>
                      {t.tax}
                    </span>
                  </td>

                  <td className="py-4 px-4 text-center">
                    {t.codeChanges ? (
                      <Check className="w-4 h-4 text-emerald-400 inline-block" />
                    ) : (
                      <X className="w-4 h-4 text-red-500/70 inline-block" />
                    )}
                  </td>

                  <td className="py-4 px-4 text-center">
                    {t.localOnly ? (
                      <Check className="w-4 h-4 text-emerald-400 inline-block" />
                    ) : (
                      <X className="w-4 h-4 text-red-500/70 inline-block" />
                    )}
                  </td>

                  <td className="py-4 px-4 text-center">
                    {t.noAccount ? (
                      <Check className="w-4 h-4 text-emerald-400 inline-block" />
                    ) : (
                      <X className="w-4 h-4 text-red-500/70 inline-block" />
                    )}
                  </td>

                  <td className="py-4 px-4 text-center">
                    {t.httpLayer ? (
                      <Check className="w-4 h-4 text-emerald-400 inline-block" />
                    ) : (
                      <X className="w-4 h-4 text-red-500/70 inline-block" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </section>
  );
}
