"use client";

import { useUniverse } from "@/state/universe-context";
import { formatCount } from "@/lib/ui/format";
import { BTN, PANEL } from "./panel";

/**
 * Privacy summary surfaced from the header and import flow: where data lives,
 * what leaves the device, and what is never stored.
 */
export function PrivacyNote({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { source } = useUniverse();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Privacy"
      data-testid="privacy-note"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`${PANEL} flex max-h-[80vh] w-full max-w-md flex-col gap-3 overflow-y-auto p-5`}>
        <div className="flex items-start justify-between">
          <h2 className="text-base font-semibold text-slate-50">Privacy</h2>
          <button type="button" className={BTN} onClick={onClose}>
            ✕
          </button>
        </div>
        <ul className="flex flex-col gap-2 text-xs leading-relaxed text-slate-300">
          <li>
            Imported history is parsed and stored entirely on this device
            (IndexedDB). Nothing is uploaded to any server.
          </li>
          <li>
            Spotify tokens live in session storage for this tab only and are
            cleared on disconnect. Token exchange goes through this app&apos;s own
            server route, never a third party.
          </li>
          <li>
            Listening totals are computed only from measured records
            {source.kind !== "demo" ? ` (${formatCount(source.recordCount)} records)` : ""}.
            API rankings never inflate listening time.
          </li>
          <li>
            Sensitive export fields (IP address, user agent, device platform)
            are never persisted, even if present in the file.
          </li>
          <li>
            Remove imported data at any time from the Import dialog — the demo
            universe returns immediately.
          </li>
        </ul>
      </div>
    </div>
  );
}
