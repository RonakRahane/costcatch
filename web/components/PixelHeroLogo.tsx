"use client";

import { useEffect, useState } from "react";

export default function PixelHeroLogo() {
  const [glitch, setGlitch] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setGlitch(true);
      setTimeout(() => setGlitch(false), 200);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  // Pixel grid definitions for "AGENT-TRACE" block ascii art
  const asciiLines = [
    "█▀█ █▀▀ █▀▀ █▄░█ ▀█▀   ▀█▀ █▀█ █▀█ █▀▀ █▀▀",
    "█▀█ █▄█ ██▄ █░▀█ ░█░   ░█░ █▀▄ █▀█ █▄▄ ██▄",
  ];

  // High resolution block grid for CONDUCTOR / AGENT-TRACE visual impact
  const blockArt = [
    "███  ███  ███  ███  ███    ███  ███  ███  ███  ███",
    "█ █  █ █  █ █  █ █   █      █   █ █  █ █  █    █  ",
    "███  ███  █ █  █ █   █      █   ██▀  ███  █    ███",
    "█ █  █ █  █ █  █ █   █      █   █ ▀  █ █  █    █  ",
    "█ █  ███  ███  █ █   █      █   █ █  █ █  ███  ███",
  ];

  return (
    <div className="relative w-full flex flex-col items-center justify-center py-6 select-none">
      {/* Background glow behind pixel header */}
      <div className="absolute inset-0 bg-blue-600/10 blur-3xl rounded-full max-w-2xl mx-auto -z-10 pointer-events-none" />

      {/* Styled User-requested mask container element */}
      <div className="w-full max-w-4xl flex justify-center items-center overflow-x-auto px-4 py-2 no-scrollbar">
        <div className={`transition-transform duration-100 ${glitch ? "scale-[1.01] translate-x-1 filter hue-rotate-90" : ""}`}>
          <pre className="font-mono text-xs sm:text-base md:text-xl lg:text-2xl font-black tracking-widest text-white leading-none text-center drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]">
            {blockArt.map((line, idx) => (
              <div key={idx} className="whitespace-pre flex justify-center">
                {line.split("").map((char, charIdx) => (
                  <span
                    key={charIdx}
                    className={
                      char === "█"
                        ? "text-slate-100 hover:text-blue-400 transition-colors cursor-default"
                        : "text-transparent"
                    }
                  >
                    {char === "█" ? "■" : " "}
                  </span>
                ))}
              </div>
            ))}
          </pre>
        </div>
      </div>

      {/* Secondary technical tag subhead */}
      <div className="mt-4 flex items-center space-x-3 text-xs text-slate-400 tracking-widest uppercase font-mono border-b border-t border-slate-800 py-1.5 px-4 bg-slate-950/40">
        <span className="text-blue-400 font-bold">FIG_001</span>
        <span>·</span>
        <span>TERMINAL-NATIVE OBSERVABILITY</span>
        <span>·</span>
        <span className="text-emerald-400">2026 RELEASE</span>
      </div>
    </div>
  );
}
