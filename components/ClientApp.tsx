"use client";

import dynamic from "next/dynamic";

// WebGPU, Web Workers and localStorage only exist in the browser.
const ChessApp = dynamic(() => import("./ChessApp"), {
  ssr: false,
  loading: () => (
    <div className="boot" role="status">
      <span className="brand-mark" aria-hidden>
        ♞
      </span>
      <span>Loading</span>
    </div>
  ),
});

export default function ClientApp() {
  return <ChessApp />;
}
