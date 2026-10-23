"use client";

import { useRef, useState } from "react";
import { useUniverse } from "@/state/universe-context";
import { formatCount, formatDuration, formatDate } from "@/lib/ui/format";
import { BTN, BTN_DANGER, BTN_PRIMARY, LABEL, PANEL } from "./panel";

export function ImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    importSession,
    pickImportFiles,
    commitImport,
    cancelImport,
    removeImportedData,
    dataset,
    hasMeasuredListening,
  } = useUniverse();
  const [dragOver, setDragOver] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const hasImported = dataset.kind === "imported";
  const busy = importSession.step === "reading" || importSession.step === "committing";

  const handleFiles = (files: File[]) => {
    if (files.length > 0) void pickImportFiles(files);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Import listening history"
      data-testid="import-dialog"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className={`${PANEL} flex max-h-[88vh] w-full max-w-lg flex-col gap-4 p-5`}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-50">
              Import listening history
            </h2>
            <p className="text-xs text-slate-400">
              Spotify Extended Streaming History JSON or ZIP — processed on this
              device only.
            </p>
          </div>
          <button
            type="button"
            className={BTN}
            onClick={onClose}
            disabled={busy}
            data-testid="close-import"
          >
            ✕
          </button>
        </div>

        {importSession.step === "idle" && (
          <>
            <div
              className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
                dragOver
                  ? "border-cyan-300/60 bg-cyan-400/10"
                  : "border-white/15 bg-black/20"
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                handleFiles(Array.from(event.dataTransfer.files));
              }}
              data-testid="import-dropzone"
            >
              <p className="text-sm text-slate-200">
                Drop files here, or
              </p>
              <input
                ref={fileInput}
                type="file"
                accept=".json,.zip,application/json,application/zip"
                multiple
                className="hidden"
                data-testid="import-file-input"
                onChange={(event) => {
                  handleFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className={BTN_PRIMARY}
                onClick={() => fileInput.current?.click()}
              >
                Choose files
              </button>
            </div>

            {importSession.readErrors.length > 0 && (
              <ul
                className="flex flex-col gap-1 rounded-lg border border-rose-400/25 bg-rose-500/10 p-3 text-xs text-rose-100"
                data-testid="import-errors"
              >
                {importSession.readErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}

            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                className="text-left text-[11px] font-medium text-cyan-300/90 hover:text-cyan-200"
                onClick={() => setHelpOpen((v) => !v)}
                aria-expanded={helpOpen}
              >
                {helpOpen ? "▾" : "▸"} How to get your data &amp; supported files
              </button>
              {helpOpen && (
                <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-[11px] leading-relaxed text-slate-400">
                  <p className="mb-1.5">
                    <span className={LABEL}>Request your export</span>
                  </p>
                  <ol className="mb-2 list-inside list-decimal space-y-0.5">
                    <li>
                      Go to Spotify&apos;s <span className="text-cyan-300">Account &gt; Privacy &gt; Download your data</span>.
                    </li>
                    <li>
                      Request <span className="text-violet-300">Extended streaming history</span> (not just the &quot;Account data&quot; summary). Downloads are not instant and may take days.
                    </li>
                    <li>
                      When you receive the email, download the ZIP/files and import them here. You may need multiple JSON files across the archive.
                    </li>
                  </ol>
                  <p className="mb-1.5">
                    <span className={LABEL}>Accepted files</span>
                  </p>
                  <ul className="mb-2 list-inside list-disc space-y-0.5">
                    <li>
                      <code className="text-violet-300">StreamingHistory*.json</code>{" "}
                      — older Spotify export format
                    </li>
                    <li>
                      <code className="text-violet-300">endsong_*.json</code> — newer
                      Extended Streaming History format
                    </li>
                    <li>
                      A <code className="text-violet-300">.zip</code> containing
                      one or more of the above (we only parse likely history JSON files)
                    </li>
                  </ul>
                  <p>
                    Fields used: track name, artist name(s), album name, ms played,
                    timestamps. Podcast episodes are skipped; zero-duration plays are
                    counted but flagged; negative/malformed durations are flagged as
                    malformed (not clamped). Duplicates and partial overlaps are
                    deduplicated safely. Nothing is uploaded anywhere — all parsing and
                    storage stay on this device.
                  </p>
                </div>
              )}
            </div>

            {hasImported && (
              <div className="flex items-center justify-between rounded-lg border border-rose-400/20 bg-rose-500/[0.07] p-3">
                <p className="text-[11px] text-rose-100/90">
                  Imported history is stored on this device only.
                </p>
                <button
                  type="button"
                  className={BTN_DANGER}
                  onClick={() => void removeImportedData()}
                  data-testid="remove-imported"
                >
                  Remove imported data
                </button>
              </div>
            )}
          </>
        )}

        {importSession.step === "reading" && (
          <p className="py-6 text-center text-sm text-slate-300" data-testid="import-reading">
            Reading files…
          </p>
        )}

        {importSession.step === "preview" && (
          <>
            <div className="flex flex-col gap-2 overflow-y-auto">
              {importSession.parsed.map((parsed, index) => {
                const p = parsed.preview;
                return (
                  <div
                    key={`${p.fileName}-${index}`}
                    className="rounded-lg border border-white/10 bg-black/25 p-3"
                    data-testid="import-preview-file"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-slate-100">
                        {p.fileName}
                      </span>
                      {p.duplicateOfFile && (
                        <span className="shrink-0 rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                          Duplicate
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {p.detectedFormat} · {formatCount(p.recordCount)} records ·{" "}
                      {formatDuration(p.totalListeningMs)} · {formatCount(p.uniqueTracks)}{" "}
                      unique tracks
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {p.periodStartMs !== null && p.periodEndMs !== null
                        ? `${formatDate(p.periodStartMs)} – ${formatDate(p.periodEndMs)}`
                        : "no timestamps"}
                      {p.skippedPodcasts > 0 && ` · ${p.skippedPodcasts} podcasts skipped`}
                      {p.malformedEntries > 0 &&
                        ` · ${p.malformedEntries} malformed entries flagged`}
                      {p.zeroDurationPlays > 0 &&
                        ` · ${p.zeroDurationPlays} zero-duration plays`}
                    </p>
                  </div>
                );
              })}
            </div>

            {importSession.readErrors.length > 0 && (
              <ul
                className="flex flex-col gap-1 rounded-lg border border-amber-300/25 bg-amber-400/10 p-3 text-xs text-amber-100"
                data-testid="import-errors"
              >
                {importSession.readErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}

            {importSession.skippedZipEntries.length > 0 && (
              <p
                className="rounded-lg border border-white/10 bg-black/25 p-3 text-[11px] leading-relaxed text-slate-400"
                data-testid="import-skipped-zip"
              >
                Skipped {formatCount(importSession.skippedZipEntries.length)}{" "}
                unrelated file
                {importSession.skippedZipEntries.length === 1 ? "" : "s"} inside the
                ZIP (not streaming-history JSON):{" "}
                <span className="text-slate-500">
                  {importSession.skippedZipEntries.slice(0, 3).join(", ")}
                  {importSession.skippedZipEntries.length > 3 ? ", …" : ""}
                </span>
              </p>
            )}

            {!hasMeasuredListening && (
              <p className="text-[11px] text-slate-400">
                Your current universe has no measured listening — importing will
                replace it.
              </p>
            )}
            {hasImported && (
              <p className="text-[11px] text-slate-400">
                Merge keeps your existing {formatCount(dataset.records.length)} records
                and adds these files; Replace discards them first. Duplicate files
                are skipped either way.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={BTN_PRIMARY}
                onClick={() => void commitImport(hasImported ? "merge" : "replace")}
                data-testid="import-merge"
                disabled={importSession.parsed.every((p) => p.preview.duplicateOfFile)}
              >
                {hasImported ? "Merge into current" : "Import"}
              </button>
              {hasImported && (
                <button
                  type="button"
                  className={BTN}
                  onClick={() => void commitImport("replace")}
                  data-testid="import-replace"
                  disabled={importSession.parsed.every((p) => p.preview.duplicateOfFile)}
                >
                  Replace current
                </button>
              )}
              <button
                type="button"
                className={BTN}
                onClick={() => {
                  cancelImport();
                  onClose();
                }}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {importSession.step === "committing" && (
          <p className="py-6 text-center text-sm text-slate-300">
            Applying import…
          </p>
        )}

        {importSession.step === "done" && importSession.summary && (
          <>
            <div
              className="rounded-lg border border-emerald-300/25 bg-emerald-400/10 p-3 text-xs leading-relaxed text-emerald-100"
              data-testid="import-summary"
            >
              <p className="font-semibold">
                Imported {formatCount(importSession.summary.importedRecordCount)} records
                ({importSession.summary.mode}).
              </p>
              <p className="mt-1 text-emerald-100/80">
                {formatCount(importSession.summary.totalRecords)} total records now ·{" "}
                {formatDuration(importSession.summary.measuredListeningMs)} measured ·{" "}
                {importSession.summary.skippedPodcasts} podcasts skipped ·{" "}
                {importSession.summary.malformedEntries} malformed flagged ·{" "}
                {importSession.summary.zeroDurationPlays} zero-duration plays ·{" "}
                {importSession.summary.duplicateFiles} duplicate file
                {importSession.summary.duplicateFiles === 1 ? "" : "s"} skipped.
              </p>
            </div>
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={() => {
                cancelImport();
                onClose();
              }}
              data-testid="import-done"
            >
              Explore your universe
            </button>
          </>
        )}
      </div>
    </div>
  );
}
