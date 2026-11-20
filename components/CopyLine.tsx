"use client";
import { useState } from "react";

export function CopyLine({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="ld-copy">
      <code>{value}</code>
      <button type="button" className="sk-btn sk-btn-quiet" onClick={() => { void navigator.clipboard.writeText(value).then(() => { setOk(true); setTimeout(() => setOk(false), 1600); }); }}>{ok ? "Copied ✓" : "Copy"}</button>
    </div>
  );
}
