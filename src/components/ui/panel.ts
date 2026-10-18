export const PANEL =
  "rounded-xl border border-white/10 bg-slate-950/60 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-md";

export const BTN =
  "rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-40";

export const BTN_PRIMARY =
  "rounded-lg border border-cyan-300/30 bg-cyan-400/15 px-3.5 py-1.5 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/25 focus-visible:outline-2 focus-visible:outline-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-40";

export const BTN_DANGER =
  "rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-100 transition-colors hover:bg-rose-500/20 focus-visible:outline-2 focus-visible:outline-rose-300/70 disabled:cursor-not-allowed disabled:opacity-40";

export const INPUT =
  "rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-300/40 focus:outline-none";

export const LABEL = "text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400";

export function kindLabel(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
