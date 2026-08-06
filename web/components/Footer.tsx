"use client";

export default function Footer() {
  return (
    <footer className="py-12 bg-[#090a0f] border-t border-white/10 font-mono text-xs text-slate-500">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-6">
        
        {/* Left Status & Copyright */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 px-2.5 py-1 rounded text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>ALL TRACES 100% LOCAL</span>
          </div>
          <span>© 2026 · OPEN SOURCE · MIT</span>
        </div>

        {/* Right Nav Footer Links */}
        <div className="flex items-center space-x-6 text-slate-400">
          <a
            href="https://github.com/RonakRahane/costcatch"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors"
          >
            GITHUB
          </a>
          <a href="#how-it-works" className="hover:text-white transition-colors">
            ABOUT
          </a>
          <a href="#demo" className="hover:text-white transition-colors">
            CATALOG
          </a>
          <a href="#comparison" className="hover:text-white transition-colors">
            GLOSSARY
          </a>
          <a
            href="https://github.com/RonakRahane/costcatch/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors"
          >
            REPORT ISSUE
          </a>
        </div>

      </div>
    </footer>
  );
}
