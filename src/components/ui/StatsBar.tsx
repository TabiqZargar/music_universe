"use client";

import { useUniverse } from "@/state/universe-context";
import { formatCount, formatDuration } from "@/lib/ui/format";
import { BTN, LABEL } from "./panel";

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex min-w-fit flex-col gap-0.5 px-2">
      <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </span>
      <span className="text-xs font-medium text-slate-100" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

export function StatsBar({
  onOpenFilters,
  onOpenOverview,
  onOpenPrivacy,
}: {
  onOpenFilters: () => void;
  onOpenOverview: () => void;
  onOpenPrivacy: () => void;
}) {
  const {
    filterResult,
    hasMeasuredListening,
    timeframe,
    setTimeframe,
    selectionId,
    select,
    resetView,
  } = useUniverse();

  const stats = filterResult.visibleStats;

  return (
    <footer
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col gap-1.5 p-3 sm:p-4"
      data-testid="stats-bar"
    >
      <div className="pointer-events-auto flex items-center justify-between gap-3 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/60 px-2 py-1.5 backdrop-blur-md">
        <div className="flex items-center divide-x divide-white/5 overflow-x-auto">
          <Stat
            label={hasMeasuredListening ? "Total time" : "Measured time"}
            value={hasMeasuredListening ? formatDuration(stats.totalListeningMs) : "unavailable"}
            testId="stat-total"
          />
          <Stat label="Artists" value={formatCount(stats.uniqueArtists)} testId="stat-artists" />
          <Stat label="Tracks" value={formatCount(stats.uniqueTracks)} testId="stat-tracks" />
          <Stat label="Albums" value={formatCount(stats.uniqueAlbums)} testId="stat-albums" />
          <Stat label="Genres" value={formatCount(stats.uniqueGenres)} testId="stat-genres" />
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div
            className="flex items-center rounded-lg border border-white/10 bg-black/30 p-0.5"
            role="group"
            aria-label="Timeframe"
          >
            {timeframe.options.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={timeframe.id === option.id}
                onClick={() => setTimeframe(option.id)}
                data-testid={`timeframe-${option.id}`}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  timeframe.id === option.id
                    ? "bg-violet-400/25 text-violet-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`${BTN} md:hidden`}
            onClick={onOpenFilters}
            data-testid="open-filters-mobile"
          >
            Filters
          </button>
          <button
            type="button"
            className={`${BTN} md:hidden`}
            onClick={onOpenOverview}
            data-testid="open-overview"
          >
            Stats
          </button>
          <button
            type="button"
            className={BTN}
            onClick={() => select(null, false)}
            disabled={!selectionId}
            data-testid="clear-selection"
          >
            Clear
          </button>
          <button
            type="button"
            className={BTN}
            onClick={resetView}
            data-testid="reset-view"
          >
            Reset view
          </button>
        </div>
      </div>
      <p className="hidden px-1 text-[10px] text-slate-600 md:block">
        <span className={LABEL}>Hints</span>
        <span className="ml-2">
          Drag to orbit · Scroll to zoom · Click a node to focus · Size = listening
          time · Color = entity type
        </span>
        <button
          type="button"
          className="ml-3 underline decoration-dotted underline-offset-2 hover:text-slate-400"
          onClick={onOpenPrivacy}
          data-testid="open-privacy"
        >
          Privacy
        </button>
      </p>
    </footer>
  );
}
