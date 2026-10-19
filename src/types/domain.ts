export type EntityKind = "genre" | "artist" | "album" | "track";

export type DataSourceKind = "imported" | "spotify-api" | "demo";

export interface ListeningRecord {
  /** Stable identity: Spotify track id when available, else normalized composite key. */
  trackKey: string;
  /** Epoch ms of the play when the source provides a timestamp, else null. */
  timestamp: number | null;
  trackName: string;
  artistNames: string[];
  albumName: string | null;
  spotifyTrackId: string | null;
  msPlayed: number;
  source: DataSourceKind;
  importBatchId: string;
}

export interface Artist {
  id: string;
  name: string;
  spotifyId: string | null;
  genres: string[];
  /** Sum of full track listening time across credited tracks (overlaps on collaborations). */
  listeningMs: number;
  trackIds: string[];
  albumIds: string[];
}

export interface Album {
  id: string;
  name: string;
  artistIds: string[];
  /** Sum of track listening time for tracks on this album. */
  listeningMs: number;
  trackIds: string[];
  artworkUrl: string | null;
}

export interface Track {
  id: string;
  name: string;
  artistIds: string[];
  albumId: string | null;
  spotifyId: string | null;
  /** Sum of msPlayed across records with this identity. */
  listeningMs: number;
  /** Count of imported play records (measured, not estimated). */
  playRecordCount: number;
}

export interface Genre {
  id: string;
  name: string;
  artistIds: string[];
  /** Overlapping attribution: full track time of credited artists' tracks; never sum genres to a global total. */
  listeningMs: number;
}

export interface ListeningPeriod {
  startMs: number;
  endMs: number;
  label: string;
}

export type DataSourceKindMixed = DataSourceKind | "combined";

export interface DataSourceMetadata {
  kind: DataSourceKindMixed;
  /** Start of the underlying data, independent of any active filter. */
  periodStartMs: number | null;
  periodEndMs: number | null;
  recordCount: number;
  batches: ImportBatchInfo[];
  apiSources: string[];
}

export interface ImportBatchInfo {
  id: string;
  fileName: string;
  fileHash: string;
  importedAtMs: number;
  recordCount: number;
}

export interface ImportPreview {
  fileName: string;
  detectedFormat: string;
  recordCount: number;
  skippedPodcasts: number;
  malformedEntries: number;
  /** Kept, but carries no measured duration (e.g. instant skips, 0 ms). */
  zeroDurationPlays: number;
  uniqueTracks: number;
  totalListeningMs: number;
  periodStartMs: number | null;
  periodEndMs: number | null;
  duplicateOfFile: string | null;
}

export interface ImportResult {
  ok: boolean;
  preview: ImportPreview;
  /** Records are only kept after the user confirms replace/merge. */
  records: ListeningRecord[];
  errors: string[];
}

export type SpotifyConnectionStatus =
  | "disconnected"
  | "redirecting"
  | "connecting"
  | "connected"
  | "error";

export interface SpotifyConnectionState {
  status: SpotifyConnectionStatus;
  profile: { displayName: string; id: string; imageUrl: string | null } | null;
  /** Short human-readable reason for `error`; never contains tokens. */
  error: string | null;
  scopes: string[];
}

export interface GraphNode {
  id: string;
  kind: EntityKind;
  label: string;
  listeningMs: number;
  /** Normalized radius in [0, 1] from the sqrt scale; scene maps it to world units. */
  normRadius: number;
  /** Deterministic world position produced by the layout pass. */
  position: [number, number, number];
  parentIds: string[];
  childIds: string[];
  genreIds: string[];
  /** Extra payloads kept out of the hot render path but needed by the detail panel. */
  meta: GraphNodeMeta;
}

export interface GraphNodeMeta {
  artistNames?: string[];
  albumName?: string | null;
  albumId?: string | null;
  trackIds?: string[];
  albumIds?: string[];
  spotifyId?: string | null;
  spotifyTrackId?: string | null;
  artworkUrl?: string | null;
  playRecordCount?: number;
  rankByListening?: number;
  trackCount?: number;
  artistCount?: number;
  genres?: string[];
  apiPopularity?: number;
  /** 1-based Spotify top-ranking position (API mode, no measured data). */
  apiRank?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: "genre-artist" | "artist-album" | "album-track" | "artist-track";
}

export interface UniverseStats {
  totalListeningMs: number;
  uniqueTracks: number;
  uniqueArtists: number;
  uniqueAlbums: number;
  uniqueGenres: number;
  topArtists: { id: string; name: string; listeningMs: number }[];
  topTracks: { id: string; name: string; artistName: string; listeningMs: number }[];
  firstListeningMs: number | null;
  lastListeningMs: number | null;
}

export interface MusicGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeById: Map<string, GraphNode>;
  /** Adjacency for selection highlighting. */
  neighbors: Map<string, string[]>;
  stats: UniverseStats;
  source: DataSourceMetadata;
  /** Listening time available only from measured records (imports/demo), not API rankings. */
  hasMeasuredListening: boolean;
}

export interface TimeframeOption {
  id: "4w" | "6m" | "all";
  label: string;
}

export interface ActiveFilters {
  entityKinds: Record<EntityKind, boolean>;
  genreIds: string[] | null;
  minListeningMs: number;
  rangeStartMs: number | null;
  rangeEndMs: number | null;
}
