import type { ImportBatchInfo, ImportResult, ListeningRecord } from "@/types/domain";
import { hashContent, parseHistoryJson } from "./parse";

export interface RawImportFile {
  name: string;
  text: string;
}

export type ImportMode = "replace" | "merge";

/**
 * Read selected File objects. JSON files are read directly; ZIP archives are
 * expanded and only file names that look like streaming history are parsed.
 */
export async function readImportFiles(files: File[]): Promise<{
  jsons: RawImportFile[];
  skippedZipEntries: string[];
  errors: string[];
}> {
  const jsons: RawImportFile[] = [];
  const skippedZipEntries: string[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith(".zip")) {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const entryNames = Object.keys(zip.files);
        for (const name of entryNames) {
          const entry = zip.files[name];
          if (entry.dir) continue;
          if (!name.toLowerCase().endsWith(".json")) {
            skippedZipEntries.push(name);
            continue;
          }
          const base = name.split("/").pop() ?? name;
          if (!isLikelyHistoryName(base)) {
            skippedZipEntries.push(name);
            continue;
          }
          jsons.push({ name: base, text: await entry.async("string") });
        }
      } else if (lower.endsWith(".json")) {
        jsons.push({ name: file.name, text: await file.text() });
      } else {
        errors.push(`Unsupported file type: ${file.name}`);
      }
    } catch (err) {
      errors.push(
        `Could not read ${file.name}: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }
  return { jsons, skippedZipEntries, errors };
}

function isLikelyHistoryName(name: string): boolean {
  return /streaming|endsong|history/i.test(name) && name.toLowerCase().endsWith(".json");
}

export interface ParsedImport extends ImportResult {
  fileHash: string;
}

/**
 * Parse every file in the selection and mark content-identical files
 * (same export uploaded twice, or the same file picked twice) as duplicates
 * of the first occurrence — they contribute no extra records.
 *
 * `knownFileHashes` maps a hash already stored in the dataset (from a prior
 * import) to its original file name. Files matching a stored hash are shown as
 * duplicates in the preview instead of a misleading full record count, so the
 * "already imported" state is visible before the user commits.
 */
export function previewImportSelection(
  files: RawImportFile[],
  knownFileHashes: ReadonlyMap<string, string> = new Map(),
): {
  parsed: ParsedImport[];
  errors: string[];
} {
  const errors: string[] = [];
  const parsed: ParsedImport[] = [];
  const seenHashes = new Map<string, string>(knownFileHashes);

  for (const file of files) {
    const fileHash = hashContent(file.text);
    const result = parseHistoryJson(file.text, { fileName: file.name });
    errors.push(...result.errors);

    const duplicateOf = seenHashes.get(fileHash) ?? null;
    if (duplicateOf !== null) {
      parsed.push({
        ...result,
        fileHash,
        records: [],
        preview: { ...result.preview, duplicateOfFile: duplicateOf, recordCount: 0, uniqueTracks: 0, totalListeningMs: 0 },
        errors: [],
      });
      continue;
    }
    seenHashes.set(fileHash, file.name);
    parsed.push({ ...result, fileHash });
  }
  return { parsed, errors };
}

/** Records that are exact repeats (same identity, timestamp, duration) collapse to one. */
export function dedupeRecords(records: ListeningRecord[]): ListeningRecord[] {
  const seen = new Set<string>();
  const out: ListeningRecord[] = [];
  for (const r of records) {
    const sig = `${r.trackKey}|${r.timestamp ?? ""}|${r.msPlayed}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(r);
  }
  return out;
}

export function applyImport(
  parsed: ParsedImport[],
  mode: ImportMode,
  existing: { records: ListeningRecord[]; batches: ImportBatchInfo[] },
): { records: ListeningRecord[]; batches: ImportBatchInfo[]; importedRecordCount: number } {
  const parsedFiles = parsed.filter((p) => p.ok && p.records.length > 0);

  const keptRecords = mode === "replace" ? [] : existing.records;
  const keptBatches = mode === "replace" ? [] : existing.batches;

  // Re-importing content already stored (same fileHash) adds no batch and no
  // records — dedupeRecords below also collapses any overlapping plays.
  const knownHashes = new Set(keptBatches.map((b) => b.fileHash));
  const newBatches: ImportBatchInfo[] = [];
  for (const p of parsedFiles) {
    if (knownHashes.has(p.fileHash)) continue;
    knownHashes.add(p.fileHash);
    newBatches.push({
      id: p.records[0].importBatchId,
      fileName: p.preview.fileName,
      fileHash: p.fileHash,
      importedAtMs: Date.now(),
      recordCount: p.records.length,
    });
  }

  const records = dedupeRecords([...keptRecords, ...parsedFiles.flatMap((p) => p.records)]);
  return {
    records,
    batches: [...keptBatches, ...newBatches],
    // Honestly report only records that actually extended the dataset.
    importedRecordCount: Math.max(0, records.length - keptRecords.length),
  };
}
