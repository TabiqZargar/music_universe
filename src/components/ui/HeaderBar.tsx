"use client";

import { useUniverse } from "@/state/universe-context";
import { SourceBadge } from "./SourceBadge";
import { SearchBar } from "./SearchBar";
import { BTN } from "./panel";

export function HeaderBar({
  onOpenImport,
  onOpenConnection,
}: {
  onOpenImport: () => void;
  onOpenConnection: () => void;
}) {
  const { source, connection, dataset } = useUniverse();

  const title =
    source.kind === "demo"
      ? "Demo Universe"
      : source.kind === "spotify-api"
        ? `${connection.profile?.displayName ?? "Your"} — Spotify`
        : "My Listening History";

  return (
    <header
      className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-2 p-3 sm:p-4"
      data-testid="header-bar"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="pointer-events-auto flex items-center gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.34em] text-violet-300/80">
              Music Universe
            </span>
            <h1 className="max-w-[46vw] truncate text-lg font-semibold leading-tight text-slate-50 sm:text-xl">
              {title}
            </h1>
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <SearchBar />
          <button
            type="button"
            className={BTN}
            onClick={onOpenImport}
            data-testid="open-import"
          >
            Import
          </button>
          <button
            type="button"
            className={BTN}
            onClick={onOpenConnection}
            data-testid="open-connection"
          >
            {connection.status === "connected"
              ? connection.profile?.displayName ?? "Connected"
              : "Connect Spotify"}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <SourceBadge source={source} />
        {dataset.kind === "imported" && (
          <span className="text-[11px] text-slate-500">
            Saved on this device
          </span>
        )}
        {source.kind === "demo" && (
          <span className="text-[11px] text-slate-500">
            Demo data — import your history or connect to explore your own
          </span>
        )}
        {source.kind === "spotify-api" && (
          <span className="text-[11px] text-slate-500">
            Sized by Spotify rankings, not listening time
          </span>
        )}
        {source.kind === "combined" && (
          <span className="text-[11px] text-slate-500">
            API used only for genres &amp; artwork
          </span>
        )}
      </div>
    </header>
  );
}
