"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Copied from the hero run in data/site-captures.ts, so update them together.
const FEED = [
  "costcatch",
  "costcatch python research_agent.py",
  "6 LLM calls · 5 tool calls · $0.08",
  "1 failed LLM call · 3 failed tool calls",
];

export default function SiteNav() {
  const [text, setText] = useState(FEED[0]);

  const msg = useRef(0);
  const char = useRef(FEED[0].length);
  const erasing = useRef(false);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let timer: ReturnType<typeof setTimeout>;

    function tick() {
      const message = FEED[msg.current];

      if (erasing.current) {
        char.current -= 1;
        setText(message.slice(0, char.current));
        if (char.current === 0) {
          erasing.current = false;
          msg.current = (msg.current + 1) % FEED.length;
          timer = setTimeout(tick, 240);
          return;
        }
        timer = setTimeout(tick, 16);
        return;
      }

      char.current += 1;
      setText(message.slice(0, char.current));
      if (char.current === message.length) {
        erasing.current = true;
        timer = setTimeout(tick, msg.current === 0 ? 2600 : 1700);
        return;
      }
      timer = setTimeout(tick, 30);
    }

    timer = setTimeout(() => {
      erasing.current = true;
      tick();
    }, 2600);

    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <a className="skip" href="#content">
        Skip to content
      </a>

      <div className="topline">
        <div className="canvas topline-in">
          <span className="sig" aria-hidden />
          <span className="wide-only">free · open source · runs on your machine</span>
          <span className="narrow-only">free · open source</span>
          <span>MIT · v0.1.0</span>
        </div>
      </div>

      <div className="nav">
        <div className="canvas nav-in">
          <Link className="mark" href="/" aria-label="costcatch — home">
            <span className="mark-row" aria-hidden>
              <span className="caret">&gt;</span>
            </span>
            <span className="mark-row" aria-hidden>
              <span className="caret">&gt;</span>
            </span>
            <span className="mark-row" aria-hidden>
              <span className="caret">&gt;</span>
            </span>
            <span className="mark-row on">
              <span className="caret">&gt;</span>
              <span className="mark-name">{text}</span>
              <span className="blink" aria-hidden />
            </span>
          </Link>

        </div>
      </div>
    </>
  );
}
