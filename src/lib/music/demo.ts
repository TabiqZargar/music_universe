import type { ListeningRecord } from "@/types/domain";
import type { ArtistEnrichment } from "@/lib/music/aggregate";
import { compositeTrackKey, normalizeName } from "@/lib/music/keys";

export const DEMO_DATASET_ID = "demo-v1";
export const DEMO_DATASET_TITLE = "Demo Universe";

const GENRES: { name: string; artists: string[][] }[] = [
  {
    name: "Dream Pop",
    artists: [
      ["Aurora Vale", "Glass Meridian"],
      ["Lumen Field", "Halcyon Reef"],
      ["Soft Static", "Moonflower"],
    ],
  },
  {
    name: "Synthwave",
    artists: [
      ["Neon Divide", "Vector Plaza"],
      ["Chrome Cascade", "Night Drive 84"],
      ["Pulse Injector", "Retrograde"],
    ],
  },
  {
    name: "Afrobeat",
    artists: [
      ["Kofi Adjei", "The Accra Tapes"],
      ["Zola Mbeki", "Lagos Nights"],
      ["Sema Band", "Benga Union"],
    ],
  },
  {
    name: "Ambient",
    artists: [
      ["Still Harbor", "Ionosphere"],
      ["Weather Static", "Longform"],
    ],
  },
  {
    name: "Jazz",
    artists: [
      ["Marlowe Quintet", "Blue Room Sessions"],
      ["Ida Farrow", "Copper Vine"],
      ["The Ellery Trio", "Late Set"],
    ],
  },
  {
    name: "Post-Rock",
    artists: [
      ["Tidal Atlas", "Northern Signal"],
      ["Cathedral Pines", "Slow Cartography"],
      ["Vermilion Hours", "Fieldnotes"],
    ],
  },
  {
    name: "Hip-Hop",
    artists: [
      ["Juno West", "Block Psalm"],
      ["Kaire", "Rooftop Tapes"],
      ["Mason Grey", "Static Prose"],
    ],
  },
  {
    name: "Indie Folk",
    artists: [
      ["Fern Hollow", "The Orchard Year"],
      ["Wren Calloway", "Paper Lanterns"],
      ["Harborlight", "Tidewater"],
    ],
  },
];

const ADJ = [
  "Golden", "Silent", "Amber", "Distant", "Hollow", "Bright", "Slow", "Violet",
  "Northern", "Paper", "Copper", "Midnight", "Emerald", "Faded", "Electric",
  "Quiet", "Restless", "Silver", "Warm", "Fractured",
];
const NOUN = [
  "Static", "Bloom", "Harbor", "Signal", "Garden", "Meridian", "Tide", "Mirror",
  "Orbit", "Lantern", "Current", "Weather", "Archive", "Parade", "Cinema",
  "Compass", "Fever", "Echo", "Highway", "Meadow",
];

const ALBUM_A = ["First", "Second", "Northern", "Electric", "Quiet", "Late", "Open"];
const ALBUM_B = ["Seasons", "Rooms", "Motions", "Letters", "Maps", "Hours", "Ways"];

interface DemoBuilt {
  records: ListeningRecord[];
  enrichment: Required<Pick<ArtistEnrichment, "genresByArtistName">>;
}

/**
 * Fully synthetic, deterministic demo dataset (spec §15 keeps synthetic data
 * separate from user statistics). Same seed → identical universe every load.
 */
export function buildDemoDataset(seed = DEMO_DATASET_ID): DemoBuilt {
  let state = 20260101;
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  // Mix the seed into the state so alternate seeds produce other universes.
  for (let i = 0; i < seed.length; i++) {
    state = (Math.imul(state, 31) + seed.charCodeAt(i)) >>> 0;
  }

  const records: ListeningRecord[] = [];
  const genresByArtistName: Record<string, string[]> = {};
  const now = Date.UTC(2026, 9, 1);
  const spanDays = 430;
  const batchId = `demo:${seed}`;

  for (const genre of GENRES) {
    for (const [artistA, artistB] of genre.artists) {
      // Enrichment lookups always go through normalizeName — key the same way.
      for (const artistName of [artistA, artistB]) {
        const key = normalizeName(artistName);
        genresByArtistName[key] = [...(genresByArtistName[key] ?? []), genre.name];
      }
      // Tracks credited so far for this pair — the partner must appear at least
      // once with at least one play, or whole artists would vanish from search.
      const creditedSeen = new Set<string>();
      const albumCount = 1 + Math.floor(rand() * 2);
      for (let a = 0; a < albumCount; a++) {
        const albumName = `${ALBUM_A[Math.floor(rand() * ALBUM_A.length)]} ${ALBUM_B[Math.floor(rand() * ALBUM_B.length)]}`;
        const trackCount = 5 + Math.floor(rand() * 6);
        const trackNames = new Set<string>();
        const primary = rand() > 0.45 ? artistA : artistB;
        const credited =
          rand() > 0.75
            ? [artistA, artistB]
            : [primary];
        const soloCollab = rand() > 0.8 ? (credited[0] === artistA ? artistB : artistA) : null;
        for (let t = 0; t < trackCount; t++) {
          let name = "";
          let guard = 0;
          do {
            name = `${ADJ[Math.floor(rand() * ADJ.length)]} ${NOUN[Math.floor(rand() * NOUN.length)]}`;
            guard++;
          } while (trackNames.has(name) && guard < 20);
          trackNames.add(name);
          const durationMs = (150 + Math.floor(rand() * 210)) * 1000;
          let artistNames = soloCollab && t % 4 === 0 ? [credited[0], soloCollab] : credited;
          const isLastTrack = a === albumCount - 1 && t === trackCount - 1;
          if (
            isLastTrack &&
            (!creditedSeen.has(artistA) || !creditedSeen.has(artistB))
          ) {
            artistNames = [artistA, artistB];
          }
          for (const creditedName of artistNames) creditedSeen.add(creditedName);
          const trackKey = compositeTrackKey(name, artistNames, albumName);
          let plays = Math.floor(rand() * rand() * 70);
          if (isLastTrack && plays === 0) plays = 1 + Math.floor(rand() * 8);
          for (let p = 0; p < plays; p++) {
            const daysAgo = Math.floor(rand() * spanDays);
            const ts = now - daysAgo * 86400000 - Math.floor(rand() * 86400000);
            const fraction = 0.35 + rand() * 0.65;
            records.push({
              trackKey,
              timestamp: ts,
              trackName: name,
              artistNames,
              albumName,
              spotifyTrackId: null,
              msPlayed: Math.round(durationMs * fraction),
              source: "demo",
              importBatchId: batchId,
            });
          }
        }
      }
    }
  }

  // Shuffle deterministically so record order does not leak authoring order.
  for (let i = records.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [records[i], records[j]] = [records[j], records[i]];
  }

  return { records, enrichment: { genresByArtistName } };
}
