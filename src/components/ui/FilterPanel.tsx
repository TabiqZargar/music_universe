"use client";

import { useMemo, useState } from "react";
import { useUniverse } from "@/state/universe-context";
import type { EntityKind } from "@/types/domain";
import { formatDuration } from "@/lib/ui/format";
import { BTN, LABEL, PANEL } from "./panel";

const KINDS: EntityKind[] = ["genre", "artist", "album", "track"];

export function FilterPanel({
  variant = "desktop",
  onClose,
}: {
  variant?: "desktop" | "mobile";
  onClose?: () => void;
}) {
  const mobile = variant === "mobile";
  const { filters, setFilters, resetFilters, filterResult, hasMeasuredListening } =
    useUniverse();
  const [genreQuery, setGenreQuery] = useState("");

  const genres = useMemo(
    () =>
      filterResult.graph.nodes
        .filter((n) => n.kind === "genre")
        .sort((a, b) => b.listeningMs - a.listeningMs),
    [filterResult.graph],
  );

  const maxArtistMs = useMemo(
    () =>
      Math.max(
        1,
        ...filterResult.graph.nodes
          .filter((n) => n.kind === "artist")
          .map((n) => n.listeningMs),
      ),
    [filterResult.graph],
  );

  const shownGenres = useMemo(() => {
    const q = genreQuery.trim().toLowerCase();
    return q ? genres.filter((g) => g.label.toLowerCase().includes(q)) : genres;
  }, [genres, genreQuery]);

  const genreIds = filters.genreIds;
  const allGenresOn = genreIds === null;

  const toggleGenre = (id: string) => {
    const allIds = genres.map((g) => g.id);
    let next: string[] | null;
    if (genreIds === null) {
      // Everything is on: the first click isolates that genre.
      next = [id];
    } else if (genreIds.includes(id)) {
      const kept = genreIds.filter((g) => g !== id);
      // Deselecting the last one falls back to the unfiltered default.
      next = kept.length === 0 || kept.length === allIds.length ? null : kept;
    } else {
      next = [...genreIds, id];
    }
    setFilters({ genreIds: next });
  };

  return (
    <aside
      className={
        mobile
          ? `${PANEL} pointer-events-auto fixed inset-x-0 bottom-0 z-40 flex max-h-[62vh] w-full flex-col gap-4 overflow-y-auto rounded-b-none p-4`
          : `${PANEL} pointer-events-auto absolute bottom-28 left-3 z-30 hidden max-h-[calc(100vh-13rem)] w-56 flex-col gap-4 overflow-y-auto p-3.5 md:flex`
      }
      data-testid="filter-panel"
      aria-label="Filters"
    >
      <div className="flex items-center justify-between">
        <span className={LABEL}>Filters</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-[10px] font-medium text-cyan-300/80 hover:text-cyan-200"
            onClick={resetFilters}
            data-testid="reset-filters"
          >
            Reset
          </button>
          {mobile && (
            <button
              type="button"
              className={BTN}
              onClick={onClose}
              aria-label="Close filters"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((kind) => {
          const on = filters.entityKinds[kind];
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={on}
              data-testid={`filter-kind-${kind}`}
              onClick={() =>
                setFilters({
                  entityKinds: { ...filters.entityKinds, [kind]: !on },
                })
              }
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                on
                  ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-100"
                  : "border-white/10 bg-white/[0.03] text-slate-500 hover:bg-white/[0.07]"
              }`}
            >
              {kind}
            </button>
          );
        })}
      </div>

      {genres.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className={LABEL}>Genres</span>
            {!allGenresOn && (
              <button
                type="button"
                className="text-[10px] font-medium text-cyan-300/80 hover:text-cyan-200"
                onClick={() => setFilters({ genreIds: null })}
              >
                All
              </button>
            )}
          </div>
          {genres.length > 8 && (
            <input
              type="search"
              aria-label="Filter genres"
              placeholder="Find genre…"
              value={genreQuery}
              onChange={(e) => setGenreQuery(e.target.value)}
              className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none"
            />
          )}
          <div className="flex max-h-44 flex-col gap-0.5 overflow-y-auto pr-0.5">
            {shownGenres.map((genre) => {
              const on = allGenresOn || genreIds?.includes(genre.id);
              return (
                <button
                  key={genre.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  data-testid={`filter-genre-${genre.id}`}
                  onClick={() => toggleGenre(genre.id)}
                  className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors ${
                    on ? "text-slate-200 hover:bg-white/5" : "text-slate-600 hover:bg-white/[0.04]"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        on ? "bg-violet-400" : "bg-slate-700"
                      }`}
                    />
                    <span className="truncate">{genre.label}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-500">
                    {formatDuration(genre.listeningMs)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className={LABEL}>Min listening</span>
          <span className="text-[10px] text-slate-400">
            {filters.minListeningMs === 0
              ? "off"
              : formatDuration(filters.minListeningMs)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={maxArtistMs}
          step={Math.max(1, Math.floor(maxArtistMs / 60))}
          value={filters.minListeningMs}
          aria-label="Minimum listening time"
          data-testid="filter-min-listening"
          onChange={(e) => setFilters({ minListeningMs: Number(e.target.value) })}
          className="w-full accent-cyan-400"
        />
        {!hasMeasuredListening && (
          <p className="text-[10px] leading-snug text-slate-500">
            API mode has no measured listening — this filter uses ranking scores
            instead.
          </p>
        )}
      </div>
      <button type="button" className={`${BTN} w-full`} onClick={resetFilters}>
        Clear all filters
      </button>
    </aside>
  );
}
