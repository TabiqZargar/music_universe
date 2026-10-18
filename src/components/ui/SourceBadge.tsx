"use client";

import { memo } from "react";
import type { DataSourceMetadata } from "@/types/domain";
import { formatDate } from "@/lib/ui/format";
import { PANEL } from "./panel";

const KIND_LABEL: Record<DataSourceMetadata["kind"], string> = {
  demo: "Demo data",
  imported: "Imported history",
  "spotify-api": "Spotify API",
  combined: "Imported + Spotify API",
};

const KIND_TONE: Record<DataSourceMetadata["kind"], string> = {
  demo: "border-violet-300/25 text-violet-200 bg-violet-400/10",
  imported: "border-cyan-300/25 text-cyan-200 bg-cyan-400/10",
  "spotify-api": "border-blue-300/25 text-blue-200 bg-blue-400/10",
  combined: "border-teal-300/25 text-teal-200 bg-teal-400/10",
};

function SourceBadgeInner({ source }: { source: DataSourceMetadata }) {
  const range =
    source.periodStartMs !== null && source.periodEndMs !== null
      ? `${formatDate(source.periodStartMs)} – ${formatDate(source.periodEndMs)}`
      : "no timestamps in data";
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 ${PANEL}`}>
      <span
        data-testid="source-badge"
        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${KIND_TONE[source.kind]}`}
      >
        {KIND_LABEL[source.kind]}
      </span>
      <span className="text-[11px] text-slate-400" data-testid="source-range">
        Data: {range}
      </span>
    </div>
  );
}

export const SourceBadge = memo(SourceBadgeInner);
