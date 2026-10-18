"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useUniverse } from "@/state/universe-context";
import { PANEL, kindLabel } from "./panel";

export function SearchBar() {
  const { searchQuery, setSearchQuery, searchResults, select } = useUniverse();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Clamp instead of resetting via an effect; event handlers reset explicitly.
  const safeIndex = Math.min(activeIndex, Math.max(searchResults.length - 1, 0));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const choose = (index: number) => {
    const result = searchResults[index];
    if (!result) return;
    select(result.id, true);
    setSearchQuery("");
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative hidden sm:block">
      <input
        type="search"
        role="combobox"
        aria-label="Search artists, albums, tracks"
        aria-controls={listId}
        aria-expanded={open && searchResults.length > 0}
        placeholder="Search…"
        value={searchQuery}
        data-testid="search-input"
        onChange={(event) => {
          setSearchQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => {
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, searchResults.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(safeIndex);
          } else if (event.key === "Escape") {
            setSearchQuery("");
            setOpen(false);
          }
        }}
        className="w-44 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 backdrop-blur-md focus:w-56 focus:border-cyan-300/40 focus:outline-none lg:w-56 lg:focus:w-64"
      />
      {open && searchQuery.trim() !== "" && (
        <div
          id={listId}
          role="listbox"
          className={`${PANEL} absolute right-0 top-full z-40 mt-1.5 max-h-80 w-72 overflow-y-auto p-1`}
          data-testid="search-results"
        >
          {searchResults.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">No matches.</p>
          ) : (
            searchResults.slice(0, 24).map((result, index) => (
              <button
                key={result.id}
                type="button"
                role="option"
                aria-selected={index === safeIndex}
                onClick={() => choose(index)}
                onPointerEnter={() => setActiveIndex(index)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                  index === safeIndex ? "bg-cyan-400/15 text-cyan-50" : "text-slate-300 hover:bg-white/5"
                }`}
              >
                <span className="truncate">{result.label}</span>
                <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.14em] text-violet-300/70">
                  {kindLabel(result.kind)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
