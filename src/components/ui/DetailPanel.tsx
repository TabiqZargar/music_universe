"use client";

import { useUniverse } from "@/state/universe-context";
import type { EntityKind, GraphNode } from "@/types/domain";
import { formatCount, formatDuration, formatDate } from "@/lib/ui/format";
import { Artwork } from "./Artwork";
import { BTN, BTN_PRIMARY, LABEL, PANEL, kindLabel } from "./panel";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <span className={LABEL}>{title}</span>
      <div className="text-xs leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

function NeighborList({
  node,
  kind,
  onPick,
}: {
  node: GraphNode;
  kind: EntityKind;
  onPick: (id: string) => void;
}) {
  const { filterResult } = useUniverse();
  const items = node.childIds
    .map((id) => filterResult.graph.nodeById.get(id))
    .filter((n): n is GraphNode => n?.kind === kind);
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => b.listeningMs - a.listeningMs);
  return (
    <div className="flex flex-col gap-0.5">
      {sorted.slice(0, 12).map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onPick(item.id)}
          className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-white/5"
        >
          <span className="truncate text-slate-300">{item.label}</span>
          <span className="shrink-0 text-[10px] text-slate-500">
            {formatDuration(item.listeningMs)}
          </span>
        </button>
      ))}
      {sorted.length > 12 && (
        <span className="px-1.5 py-0.5 text-[10px] text-slate-500">
          +{sorted.length - 12} more
        </span>
      )}
    </div>
  );
}

function TimelineBars({ trackId }: { trackId: string }) {
  const { trackTimelines } = useUniverse();
  const points = trackTimelines.get(trackId);
  if (!points || points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.ms), 1);
  return (
    <div className="flex h-12 items-end gap-[3px]" data-testid="track-timeline">
      {points.map((point) => (
        <div
          key={point.startMs}
          className="flex-1 rounded-sm bg-gradient-to-t from-violet-500/70 to-cyan-400/80"
          style={{ height: `${Math.max(6, (point.ms / max) * 100)}%` }}
          title={`${point.label}: ${formatDuration(point.ms)}`}
        />
      ))}
    </div>
  );
}

export function DetailPanel({
  onClose,
  isMobile,
}: {
  onClose: () => void;
  isMobile: boolean;
}) {
  const {
    selectionId,
    filterResult,
    select,
    hasMeasuredListening,
    source,
    boot,
  } = useUniverse();

  const node = selectionId
    ? filterResult.graph.nodeById.get(selectionId) ?? null
    : null;

  const spotifyUrl =
    node?.kind === "track" && node.meta.spotifyTrackId
      ? `https://open.spotify.com/track/${node.meta.spotifyTrackId}`
      : node?.kind === "artist" && node.meta.spotifyId
        ? `https://open.spotify.com/artist/${node.meta.spotifyId}`
        : null;

  const pick = (id: string) => select(id, true);

  const listeningText = (ms: number) =>
    hasMeasuredListening ? formatDuration(ms) : "not measured";

  return (
    <aside
      className={`${PANEL} pointer-events-auto absolute z-30 flex w-full flex-col gap-4 overflow-y-auto p-4
        inset-x-0 bottom-0 max-h-[52vh] rounded-b-none
        md:inset-x-auto md:right-3 md:top-24 md:bottom-28 md:max-h-none md:w-72 md:rounded-xl`}
      data-testid="detail-panel"
      aria-label="Details"
    >
      <div className="flex items-start justify-between gap-2">
        {node ? (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300/80">
              {kindLabel(node.kind)}
            </span>
            <h2 className="break-words text-base font-semibold leading-snug text-slate-50">
              {node.label}
            </h2>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300/80">
              Overview
            </span>
            <h2 className="text-base font-semibold text-slate-50">
              Current universe
            </h2>
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className={BTN}
          data-testid="close-detail"
        >
          ✕
        </button>
      </div>

      {!node && (
        <>
          <Section title="Top artists">
            <div className="flex flex-col gap-0.5">
              {filterResult.visibleStats.topArtists.slice(0, 5).map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => pick(a.id)}
                  className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left hover:bg-white/5"
                >
                  <span className="truncate">
                    <span className="mr-1.5 text-slate-600">{i + 1}.</span>
                    {a.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-500">
                    {listeningText(a.listeningMs)}
                  </span>
                </button>
              ))}
            </div>
          </Section>
          <Section title="Top tracks">
            <div className="flex flex-col gap-0.5">
              {filterResult.visibleStats.topTracks.slice(0, 5).map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pick(t.id)}
                  className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left hover:bg-white/5"
                >
                  <span className="min-w-0 truncate">
                    <span className="mr-1.5 text-slate-600">{i + 1}.</span>
                    {t.name}
                    <span className="ml-1 text-slate-500">— {t.artistName}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-500">
                    {listeningText(t.listeningMs)}
                  </span>
                </button>
              ))}
            </div>
          </Section>
          <Section title="About this data">
            <p className="text-slate-400">
              {boot.warning ??
                (hasMeasuredListening
                  ? "Listening totals come from your imported history. Nodes sit in stable genre regions; size reflects listening time in the active timeframe."
                  : "Spotify ranking data drives sizes here — listening totals need a history import. Connect Spotify and import your data for real listening time.")}
            </p>
            {source.batches.length > 0 && (
              <p className="mt-1 text-slate-500">
                {source.batches.length} import batch
                {source.batches.length === 1 ? "" : "es"} ·{" "}
                {formatDate(source.batches[0]?.importedAtMs ?? null)}
              </p>
            )}
          </Section>
        </>
      )}

      {node && (
        <>
          {node.kind === "track" && (
            <>
              {node.meta.artistNames && node.meta.artistNames.length > 0 && (
                <Section title={node.meta.artistNames.length > 1 ? "Artists" : "Artist"}>
                  <p className="text-slate-200">{node.meta.artistNames.join(", ")}</p>
                </Section>
              )}
              {node.meta.albumName && (
                <Section title="Album">
                  <p className="text-slate-200">{node.meta.albumName}</p>
                </Section>
              )}
              <Section title="Listening">
                <p className="text-slate-100" data-testid="detail-listening">
                  {listeningText(node.listeningMs)}
                  {node.meta.playRecordCount !== undefined && hasMeasuredListening && (
                    <span className="ml-2 text-slate-500">
                      {formatCount(node.meta.playRecordCount)} plays
                    </span>
                  )}
                  {node.meta.apiPopularity !== undefined && (
                    <span className="ml-2 text-slate-500">
                      popularity {node.meta.apiPopularity}/100
                    </span>
                  )}
                  {!hasMeasuredListening && node.meta.apiRank !== undefined && (
                    <span className="ml-2 text-slate-500">
                      rank #{node.meta.apiRank} on Spotify
                    </span>
                  )}
                </p>
              </Section>
              <Section title="Activity over time">
                <TimelineBars trackId={node.id} />
              </Section>
            </>
          )}

          {node.kind === "artist" && (
            <>
              <Section title="Listening">
                <p className="text-slate-100" data-testid="detail-listening">
                  {listeningText(node.listeningMs)}
                  {hasMeasuredListening && node.meta.rankByListening !== undefined && (
                    <span className="ml-2 text-slate-500">
                      #{node.meta.rankByListening} by listening
                    </span>
                  )}
                  {!hasMeasuredListening && node.meta.apiRank !== undefined && (
                    <span className="ml-2 text-slate-500">
                      rank #{node.meta.apiRank} on Spotify
                    </span>
                  )}
                  {!hasMeasuredListening && node.meta.apiPopularity !== undefined && (
                    <span className="ml-2 text-slate-500">
                      popularity {node.meta.apiPopularity}/100
                    </span>
                  )}
                </p>
              </Section>
              {node.meta.genres && node.meta.genres.length > 0 && (
                <Section title="Genres">
                  <div className="flex flex-wrap gap-1">
                    {node.meta.genres.map((genre) => (
                      <span
                        key={genre}
                        className="rounded-full border border-violet-300/20 bg-violet-400/10 px-2 py-0.5 text-[10px] text-violet-200"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                </Section>
              )}
              <Section title="Tracks">
                <NeighborList node={node} kind="track" onPick={pick} />
              </Section>
              <Section title="Albums">
                <NeighborList node={node} kind="album" onPick={pick} />
              </Section>
            </>
          )}

          {node.kind === "album" && (
            <>
              <Section title="Listening">
                <p className="text-slate-100" data-testid="detail-listening">
                  {listeningText(node.listeningMs)}
                </p>
              </Section>
              <Section title="Artists">
                <NeighborList node={node} kind="artist" onPick={pick} />
              </Section>
              <Section title="Tracks">
                <NeighborList node={node} kind="track" onPick={pick} />
              </Section>
            </>
          )}

          {node.kind === "genre" && (
            <>
              <Section title="Listening">
                <p className="text-slate-100" data-testid="detail-listening">
                  {listeningText(node.listeningMs)}
                </p>
              </Section>
              <Section title="Artists">
                <NeighborList node={node} kind="artist" onPick={pick} />
              </Section>
            </>
          )}

          {(node.kind === "track" || node.kind === "album") && (
            <div className="flex items-center gap-3">
              <Artwork
                url={node.meta.artworkUrl ?? null}
                seed={node.label}
                alt={`${node.label} artwork`}
                className="h-24 w-24 shrink-0 rounded-lg border border-white/10"
              />
              {spotifyUrl && (
                <a
                  href={spotifyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={BTN}
                >
                  Open in Spotify
                </a>
              )}
            </div>
          )}

          {!hasMeasuredListening && (
            <p className="text-[10px] leading-snug text-slate-500">
              Sized from Spotify rankings — not measured listening time.
            </p>
          )}

          <div className="mt-auto flex gap-2 pt-1">
            <button
              type="button"
              className={`${BTN_PRIMARY} flex-1`}
              onClick={() => select(node.id, true)}
              data-testid="focus-camera"
            >
              Focus camera
            </button>
            <button
              type="button"
              className={BTN}
              onClick={() => select(null, false)}
            >
              Clear
            </button>
          </div>
        </>
      )}

      {isMobile && !node && (
        <p className="text-[11px] text-slate-500">
          Tap a star for details, or open Filters from the stats bar.
        </p>
      )}
    </aside>
  );
}
