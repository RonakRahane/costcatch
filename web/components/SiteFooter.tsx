import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer>
      <div className="canvas foot">
        <span className="foot-mark">costcatch</span>
        <span className="foot-links">
          <Link href="/docs">Docs</Link>
          <Link href="/demo">Demo</Link>
          <a
            href="https://github.com/RonakRahane/costcatch"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </span>
        <span className="spacer" />
        <span>© 2026 · MIT licence · prices in USD</span>
      </div>
    </footer>
  );
}
