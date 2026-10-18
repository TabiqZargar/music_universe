import type { ImportBatchInfo, ListeningRecord } from "@/types/domain";
import { listeningRecordsSchema } from "@/lib/validation/schemas";
import type { ArtistEnrichment } from "@/lib/music/aggregate";
import {
  ACTIVE_DATASET_KEY,
  DATASET_STORE,
  clearStore,
  deleteValue,
  getValue,
  putValue,
} from "./idb";

export interface StoredDataset {
  version: 1;
  records: ListeningRecord[];
  batches: ImportBatchInfo[];
  enrichment: ArtistEnrichment | null;
  savedAtMs: number;
}

export interface DatasetLoadResult {
  dataset: StoredDataset | null;
  /** Present when stored data existed but could not be trusted. */
  corruptionWarning: string | null;
}

/**
 * Load the persisted import. Validation runs through Zod before anything is
 * returned; corrupt or outdated payloads are reported and discarded so the app
 * can fall back to the demo universe instead of crashing.
 */
export async function loadDataset(): Promise<DatasetLoadResult> {
  try {
    const raw = await getValue<unknown>(DATASET_STORE, ACTIVE_DATASET_KEY);
    if (raw === undefined || raw === null) {
      return { dataset: null, corruptionWarning: null };
    }
    const candidate = raw as Partial<StoredDataset>;
    if (candidate.version !== 1 || !Array.isArray(candidate.records)) {
      return {
        dataset: null,
        corruptionWarning: "Stored dataset was in an outdated format and was ignored.",
      };
    }
    const parsed = listeningRecordsSchema.safeParse(candidate.records);
    if (!parsed.success) {
      return {
        dataset: null,
        corruptionWarning: "Stored dataset failed validation and was ignored.",
      };
    }
    return {
      dataset: {
        version: 1,
        records: parsed.data,
        batches: Array.isArray(candidate.batches)
          ? (candidate.batches as ImportBatchInfo[])
          : [],
        enrichment:
          candidate.enrichment && typeof candidate.enrichment === "object"
            ? (candidate.enrichment as ArtistEnrichment)
            : null,
        savedAtMs: typeof candidate.savedAtMs === "number" ? candidate.savedAtMs : 0,
      },
      corruptionWarning: null,
    };
  } catch {
    return {
      dataset: null,
      corruptionWarning: "Local storage could not be read; demo data is shown instead.",
    };
  }
}

export async function saveDataset(
  records: ListeningRecord[],
  batches: ImportBatchInfo[],
  enrichment: ArtistEnrichment | null = null,
): Promise<void> {
  const payload: StoredDataset = {
    version: 1,
    records,
    batches,
    enrichment,
    savedAtMs: Date.now(),
  };
  await putValue(DATASET_STORE, ACTIVE_DATASET_KEY, payload);
}

export async function removeDataset(): Promise<void> {
  try {
    await deleteValue(DATASET_STORE, ACTIVE_DATASET_KEY);
  } catch {
    await clearStore(DATASET_STORE).catch(() => undefined);
  }
}
