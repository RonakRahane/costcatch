"use client";

import { usePathname } from "next/navigation";

export default function MissedRequest() {
  const path = usePathname() || "/";

  return (
    <div className="nf-req">
      <span className="k">GET</span>
      <code className="v">{path}</code>
      <span className="k bad">✗</span>
      <span className="v">
        <span className="bad">404 not found</span>
        <span className="faint"> · </span>
        <span className="money">$0.00</span>
      </span>
    </div>
  );
}
