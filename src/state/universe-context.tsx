"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ActiveFilters,
  DataSourceMetadata,
  ImportBatchInfo,
  ListeningPeriod,
  ListeningRecord,
  SpotifyConnectionState,
  TimeframeOption,
} from "@/types/domain";
import type { ArtistEnrichment } from "@/lib/music/aggregate";
import { normalizeName } from "@/lib/music/keys";
import {
  buildMusicGraph,
  type ApiSignalArtist,
  type ApiSignalTrack,
  type MusicGraphOutput,
} from "@/lib/music/graph";
import { applyFilters, DEFAULT_FILTERS, type FilterResult } from "@/lib/music/filters";
import { recordsInRange, timeframeOptions, timeframeRange } from "@/lib/music/timeframe";
import { searchGraph, type SearchResult } from "@/lib/music/search";
import { buildDemoDataset } from "@/lib/music/demo";
import {
  applyImport,
  previewImportSelection,
  readImportFiles,
  type ImportMode,
  type ParsedImport,
} from "@/lib/import";
import { loadDataset, removeDataset, saveDataset } from "@/lib/storage/repository";
import { clearTokens, getAccessToken, loadTokens } from "@/lib/spotify/auth";
import {
  fetchProfile,
  fetchRecentlyPlayed,
  fetchTopArtists,
  fetchTopTracks,
  mergeTopArtists,
  mergeTopTracks,
  SpotifyApiError,
  TOP_TIME_RANGES,
} from "@/lib/spotify/api";
import {
  apiTopToSignals,
  artworkEnrichmentFromTracks,
  recentlyPlayedToRecords,
} from "@/lib/spotify/normalize";

export type ActiveDataset =
  | { kind: "demo"; records: ListeningRecord[]; enrichment: ArtistEnrichment }
  | { kind: "api"; records: ListeningRecord[]; enrichment: ArtistEnrichment }
  | {
      kind: "imported";
      records: ListeningRecord[];
      batches: ImportBatchInfo[];
      enrichment: ArtistEnrichment | null;
    };

export interface ImportSession {
  step: "idle" | "reading" | "preview" | "committing" | "done";
  parsed: ParsedImport[];
  readErrors: string[];
  skippedZipEntries: string[];
  summary: {
    mode: ImportMode;
    importedRecordCount: number;
    skippedPodcasts: number;
    malformedEntries: number;
    zeroDurationPlays: number;
    duplicateFiles: number;
    totalRecords: number;
    measuredListeningMs: number;
  } | null;
}

export interface ApiSnapshot {
  apiArtists: ApiSignalArtist[];
  apiTracks: ApiSignalTrack[];
  artworkByAlbumKey: Record<string, string>;
}

export interface TrackTimelinePoint {
  label: string;
  startMs: number;
  ms: number;
}

export interface TimeframeState {
  id: TimeframeOption["id"];
  options: TimeframeOption[];
  dataEndMs: number | null;
  dataPeriod: ListeningPeriod | null;
  /** Active window (null = all history). Anchored to the data, not "now". */
  range: { startMs: number; endMs: number } | null;
}

export interface UniverseContextValue {
  boot: { loading: boolean; warning: string | null };
  dataset: ActiveDataset;
  source: DataSourceMetadata;
  graph: MusicGraphOutput;
  filterResult: FilterResult;
  hasMeasuredListening: boolean;

  timeframe: TimeframeState;
  setTimeframe: (id: TimeframeOption["id"]) => void;

  filters: ActiveFilters;
  setFilters: (update: Partial<ActiveFilters>) => void;
  resetFilters: () => void;

  selectionId: string | null;
  hoverId: string | null;
  select: (id: string | null, focus?: boolean) => void;
  setHoverId: (id: string | null) => void;
  resetView: () => void;
  cameraCommand: { type: "focus" | "reset"; id: string | null; nonce: number };

  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchResults: SearchResult[];

  importSession: ImportSession;
  pickImportFiles: (files: File[]) => Promise<void>;
  commitImport: (mode: ImportMode) => Promise<void>;
  cancelImport: () => void;
  removeImportedData: () => Promise<void>;

  connection: SpotifyConnectionState;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshSpotify: () => Promise<void>;

  trackTimelines: Map<string, TrackTimelinePoint[]>;
}

const UniverseContext = createContext<UniverseContextValue | null>(null);

function periodOf(records: ListeningRecord[]): { start: number | null; end: number | null } {
  const stamps = records.map((r) => r.timestamp).filter((t): t is number => t !== null);
  if (!stamps.length) return { start: null, end: null };
  return { start: Math.min(...stamps), end: Math.max(...stamps) };
}

function demoDatasetState(): Extract<ActiveDataset, { kind: "demo" }> {
  const demo = buildDemoDataset();
  return {
    kind: "demo",
    records: demo.records,
    enrichment: { genresByArtistName: demo.enrichment.genresByArtistName },
  };
}

function buildSource(
  dataset: ActiveDataset,
  hasApiProfile: boolean,
): DataSourceMetadata {
  const { start, end } = periodOf(dataset.records);
  const apiSources = hasApiProfile ? ["top-artists", "top-tracks"] : [];
  if (dataset.kind === "demo") {
    return {
      kind: "demo",
      periodStartMs: start,
      periodEndMs: end,
      recordCount: dataset.records.length,
      batches: [],
      apiSources: [],
    };
  }
  if (dataset.kind === "api") {
    return {
      kind: "spotify-api",
      periodStartMs: start,
      periodEndMs: end,
      recordCount: dataset.records.length,
      batches: [],
      apiSources,
    };
  }
  return {
    kind: hasApiProfile ? "combined" : "imported",
    periodStartMs: start,
    periodEndMs: end,
    recordCount: dataset.records.length,
    batches: dataset.batches,
    apiSources,
  };
}

function genresEnrichmentFromSignals(
  apiArtists: ApiSignalArtist[],
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const artist of apiArtists) {
    if (artist.genres.length > 0) map[normalizeName(artist.name)] = artist.genres;
  }
  return map;
}

function mergeEnrichment(
  base: ArtistEnrichment | null,
  snapshot: ApiSnapshot | null,
): ArtistEnrichment {
  if (!snapshot) return base ?? {};
  return {
    genresByArtistName: {
      ...(base?.genresByArtistName ?? {}),
      ...genresEnrichmentFromSignals(snapshot.apiArtists),
    },
    spotifyIdByArtistName: {
      ...(base?.spotifyIdByArtistName ?? {}),
      ...Object.fromEntries(
        snapshot.apiArtists.map((a) => [normalizeName(a.name), a.id]),
      ),
    },
    artworkByAlbumKey: {
      ...(base?.artworkByAlbumKey ?? {}),
      ...snapshot.artworkByAlbumKey,
    },
  };
}

export function UniverseProvider({ children }: { children: ReactNode }) {
  const [bootLoading, setBootLoading] = useState(true);
  const [bootWarning, setBootWarning] = useState<string | null>(null);
  const [dataset, setDataset] = useState<ActiveDataset>(demoDatasetState);
  const [apiSnapshot, setApiSnapshot] = useState<ApiSnapshot | null>(null);
  const [hasApiProfile, setHasApiProfile] = useState(false);

  const [timeframeId, setTimeframeId] = useState<TimeframeOption["id"]>("all");
  const [filters, setFiltersState] = useState<ActiveFilters>(DEFAULT_FILTERS);
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [cameraCommand, setCameraCommand] = useState<{
    type: "focus" | "reset";
    id: string | null;
    nonce: number;
  }>({ type: "reset", id: null, nonce: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const [importSession, setImportSession] = useState<ImportSession>({
    step: "idle",
    parsed: [],
    readErrors: [],
    skippedZipEntries: [],
    summary: null,
  });
  const [connection, setConnection] = useState<SpotifyConnectionState>({
    status: "disconnected",
    profile: null,
    error: null,
    scopes: [],
  });

  const datasetKindRef = useRef<ActiveDataset["kind"]>("demo");
  const refreshing = useRef(false);

  const refreshSpotify = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const token = await getAccessToken();
      if (!token) {
        setConnection((prev) => ({
          ...prev,
          status: prev.status === "redirecting" ? prev.status : "disconnected",
        }));
        return;
      }
      setConnection((prev) => ({ ...prev, status: "connecting", error: null }));
      const profile = await fetchProfile();
      const hasImported = datasetKindRef.current === "imported";
      // Fetch every available top time range; merging gives broader coverage
      // (and a combined affinity rank for sizing when popularity is absent).
      const [artistLists, trackLists, recentItems] = await Promise.all([
        Promise.all(TOP_TIME_RANGES.map((timeRange) => fetchTopArtists({ timeRange, maxPages: 2 }))),
        Promise.all(TOP_TIME_RANGES.map((timeRange) => fetchTopTracks({ timeRange, maxPages: 2 }))),
        hasImported
          ? Promise.resolve([] as Awaited<ReturnType<typeof fetchRecentlyPlayed>>)
          : fetchRecentlyPlayed().catch(() => [] as Awaited<ReturnType<typeof fetchRecentlyPlayed>>),
      ]);
      const topArtists = mergeTopArtists(artistLists);
      const topTracks = mergeTopTracks(trackLists);
      const signals = apiTopToSignals(topArtists, topTracks);

      if (!hasImported) {
        const apiRecords: ListeningRecord[] = recentlyPlayedToRecords(recentItems);
        setDataset({
          kind: "api",
          records: apiRecords,
          enrichment: {
            genresByArtistName: genresEnrichmentFromSignals(signals.apiArtists),
          },
        });
        datasetKindRef.current = "api";
      }

      setApiSnapshot({ ...signals, ...artworkEnrichmentFromTracks(topTracks) });
      setHasApiProfile(true);
      setConnection({
        status: "connected",
        profile: {
          displayName: profile.display_name || profile.id,
          id: profile.id,
          imageUrl: profile.images?.[0]?.url ?? null,
        },
        error: null,
        scopes: loadTokens()?.scopes ?? [],
      });
    } catch (error) {
      const message =
        error instanceof SpotifyApiError
          ? error.status === 401
            ? "Session expired — please connect again."
            : error.status === 403
              ? "Spotify denied this request — check the app's development-mode users and granted scopes."
              : error.rateLimited
                ? "Spotify rate limit reached — try again shortly."
                : "Spotify request failed — check your connection."
          : "Spotify connection could not be verified.";
      setConnection((prev) => ({ ...prev, status: "error", error: message }));
      if (error instanceof SpotifyApiError && error.status === 401) {
        clearTokens();
        setHasApiProfile(false);
        setApiSnapshot(null);
      }
    } finally {
      refreshing.current = false;
    }
  }, []);

  // --- Boot: restore persisted import, then any Spotify session ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadDataset().catch(() => ({
        dataset: null,
        corruptionWarning: "Local storage could not be read; demo data is shown instead.",
      }));
      if (cancelled) return;
      if (stored.dataset) {
        setDataset({
          kind: "imported",
          records: stored.dataset.records,
          batches: stored.dataset.batches,
          enrichment: stored.dataset.enrichment,
        });
        datasetKindRef.current = "imported";
      }
      if (stored.corruptionWarning) setBootWarning(stored.corruptionWarning);
      // Surface a failed OAuth callback (set by /callback before redirecting back).
      try {
        const authError = sessionStorage.getItem("mu:spotify-error");
        if (authError) {
          sessionStorage.removeItem("mu:spotify-error");
          setConnection((prev) => ({ ...prev, status: "error", error: authError }));
        }
      } catch {
        // Session storage unavailable — nothing to surface.
      }
      setBootLoading(false);
      if (loadTokens()) void refreshSpotify();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSpotify]);

  // --- Derived data chain ---
  const tf = useMemo(() => timeframeOptions(dataset.records), [dataset.records]);

  const timeframe: TimeframeState = useMemo(() => {
    const valid = tf.options.some((o) => o.id === timeframeId);
    const id: TimeframeOption["id"] = valid ? timeframeId : "all";
    const all = periodOf(dataset.records);
    return {
      id,
      options: tf.options,
      dataEndMs: tf.dataEndMs,
      dataPeriod:
        all.start !== null && all.end !== null
          ? { startMs: all.start, endMs: all.end, label: "data period" }
          : null,
      range: timeframeRange(id, tf.dataEndMs),
    };
  }, [tf, timeframeId, dataset.records]);

  const rangeRecords = useMemo(
    () => recordsInRange(dataset.records, timeframe.range),
    [dataset.records, timeframe.range],
  );

  const source = useMemo(
    () => buildSource(dataset, hasApiProfile),
    [dataset, hasApiProfile],
  );

  const enrichment: ArtistEnrichment = useMemo(() => {
    if (dataset.kind === "demo" || dataset.kind === "api") return dataset.enrichment;
    return mergeEnrichment(dataset.enrichment, apiSnapshot);
  }, [dataset, apiSnapshot]);

  const graph = useMemo(
    () =>
      buildMusicGraph({
        records: rangeRecords,
        enrichment,
        source,
        apiArtists: source.kind === "spotify-api" ? apiSnapshot?.apiArtists : undefined,
        apiTracks: source.kind === "spotify-api" ? apiSnapshot?.apiTracks : undefined,
      }),
    [rangeRecords, enrichment, source, apiSnapshot],
  );

  const filterResult = useMemo(() => applyFilters(graph, filters), [graph, filters]);

  const searchResults = useMemo(() => searchGraph(graph, searchQuery), [graph, searchQuery]);

  const trackTimelines = useMemo(() => {
    const map = new Map<string, TrackTimelinePoint[]>();
    const buckets = new Map<string, Map<string, TrackTimelinePoint>>();
    for (const record of rangeRecords) {
      if (record.timestamp === null) continue;
      const d = new Date(record.timestamp);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      let perTrack = buckets.get(record.trackKey);
      if (!perTrack) {
        perTrack = new Map();
        buckets.set(record.trackKey, perTrack);
      }
      const existing = perTrack.get(key);
      if (existing) {
        existing.ms += record.msPlayed;
      } else {
        perTrack.set(key, {
          label: d.toLocaleDateString(undefined, { year: "2-digit", month: "short" }),
          startMs: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1),
          ms: record.msPlayed,
        });
      }
    }
    for (const [trackKey, perTrack] of buckets) {
      map.set(trackKey, [...perTrack.values()].sort((a, b) => a.startMs - b.startMs));
    }
    return map;
  }, [rangeRecords]);

  // --- Actions ---
  const setFilters = useCallback((update: Partial<ActiveFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...update }));
  }, []);

  const resetFilters = useCallback(() => setFiltersState(DEFAULT_FILTERS), []);

  const setTimeframe = useCallback((id: TimeframeOption["id"]) => setTimeframeId(id), []);

  const select = useCallback((id: string | null, focus = true) => {
    setSelectionId(id);
    if (id && focus) {
      setCameraCommand((prev) => ({ type: "focus", id, nonce: prev.nonce + 1 }));
    }
  }, []);

  const setHover = useCallback((id: string | null) => setHoverId(id), []);

  const resetView = useCallback(() => {
    setCameraCommand((prev) => ({ type: "reset", id: null, nonce: prev.nonce + 1 }));
  }, []);

  const pickImportFiles = useCallback(async (files: File[]) => {
    setImportSession((prev) => ({ ...prev, step: "reading", readErrors: [] }));
    const { jsons, skippedZipEntries, errors } = await readImportFiles(files);
    if (jsons.length === 0) {
      setImportSession({
        step: "idle",
        parsed: [],
        readErrors: [...errors, "No JSON history files found in the selection."],
        skippedZipEntries,
        summary: null,
      });
      return;
    }
    const knownHashes = new Map(
      (dataset.kind === "imported" ? dataset.batches : []).map((b) => [b.fileHash, b.fileName]),
    );
    const { parsed, errors: parseErrors } = previewImportSelection(jsons, knownHashes);
    setImportSession({
      step: "preview",
      parsed,
      readErrors: [...errors, ...parseErrors],
      skippedZipEntries,
      summary: null,
    });
  }, [dataset]);

  const commitImport = useCallback(
    async (mode: ImportMode) => {
      setImportSession((prev) => ({ ...prev, step: "committing", readErrors: [] }));
      const existing =
        dataset.kind === "imported"
          ? { records: dataset.records, batches: dataset.batches }
          : { records: [], batches: [] };
      const applied = applyImport(importSession.parsed, mode, existing);
      try {
        await saveDataset(applied.records, applied.batches, null);
      } catch {
        setImportSession((prev) => ({
          ...prev,
          step: "preview",
          readErrors: ["Could not save to local storage — the import was not applied."],
        }));
        return;
      }
      datasetKindRef.current = "imported";
      setDataset({
        kind: "imported",
        records: applied.records,
        batches: applied.batches,
        enrichment: null,
      });
      setFiltersState(DEFAULT_FILTERS);
      setTimeframeId("all");
      setSelectionId(null);
      setImportSession({
        step: "done",
        parsed: importSession.parsed,
        readErrors: [],
        skippedZipEntries: importSession.skippedZipEntries,
        summary: {
          mode,
          importedRecordCount: applied.importedRecordCount,
          skippedPodcasts: importSession.parsed.reduce((s, p) => s + p.preview.skippedPodcasts, 0),
          malformedEntries: importSession.parsed.reduce((s, p) => s + p.preview.malformedEntries, 0),
          zeroDurationPlays: importSession.parsed.reduce((s, p) => s + p.preview.zeroDurationPlays, 0),
          duplicateFiles: importSession.parsed.filter((p) => p.preview.duplicateOfFile !== null).length,
          totalRecords: applied.records.length,
          measuredListeningMs: importSession.parsed.reduce((s, p) => s + p.preview.totalListeningMs, 0),
        },
      });
    },
    [dataset, importSession.parsed, importSession.skippedZipEntries],
  );

  const cancelImport = useCallback(() => {
    setImportSession({ step: "idle", parsed: [], readErrors: [], skippedZipEntries: [], summary: null });
  }, []);

  const removeImportedData = useCallback(async () => {
    await removeDataset().catch(() => undefined);
    datasetKindRef.current = "demo";
    setDataset(demoDatasetState());
    setFiltersState(DEFAULT_FILTERS);
    setTimeframeId("all");
    setSelectionId(null);
    setImportSession({ step: "idle", parsed: [], readErrors: [], skippedZipEntries: [], summary: null });
    if (loadTokens()) void refreshSpotify();
  }, [refreshSpotify]);

  const connect = useCallback(async () => {
    const { createAuthRequest } = await import("@/lib/spotify/auth");
    const result = await createAuthRequest();
    if ("error" in result) {
      setConnection((prev) => ({ ...prev, status: "error", error: result.error }));
      return;
    }
    setConnection((prev) => ({ ...prev, status: "redirecting", error: null }));
    window.location.assign(result.authorizeUrl);
  }, []);

  const disconnect = useCallback(() => {
    clearTokens();
    setApiSnapshot(null);
    setHasApiProfile(false);
    setConnection({ status: "disconnected", profile: null, error: null, scopes: [] });
    if (datasetKindRef.current === "api") {
      datasetKindRef.current = "demo";
      setDataset(demoDatasetState());
    }
    setSelectionId(null);
  }, []);

  const value: UniverseContextValue = {
    boot: { loading: bootLoading, warning: bootWarning },
    dataset,
    source,
    graph,
    filterResult,
    hasMeasuredListening: graph.hasMeasuredListening,
    timeframe,
    setTimeframe,
    filters,
    setFilters,
    resetFilters,
    selectionId,
    hoverId,
    select,
    setHoverId: setHover,
    resetView,
    cameraCommand,
    searchQuery,
    setSearchQuery,
    searchResults,
    importSession,
    pickImportFiles,
    commitImport,
    cancelImport,
    removeImportedData,
    connection,
    connect,
    disconnect,
    refreshSpotify,
    trackTimelines,
  };

  return <UniverseContext.Provider value={value}>{children}</UniverseContext.Provider>;
}

export function useUniverse(): UniverseContextValue {
  const ctx = useContext(UniverseContext);
  if (!ctx) throw new Error("useUniverse must be used inside UniverseProvider");
  return ctx;
}
