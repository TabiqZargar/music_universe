import type { EntityKind, MusicGraph } from "@/types/domain";
import { normalizeName } from "./keys";

export interface SearchResult {
  id: string;
  kind: EntityKind;
  label: string;
  context: string;
  listeningMs: number;
  score: number;
}

/**
 * Search across all entity types. Matches on entity label and (for tracks)
 * artist/album context. Exact > prefix > substring, then by listening time.
 */
export function searchGraph(
  graph: MusicGraph,
  query: string,
  limit = 20,
): SearchResult[] {
  const q = normalizeName(query);
  if (!q) return [];
  const results: SearchResult[] = [];

  for (const node of graph.nodes) {
    const label = normalizeName(node.label);
    const contextParts: string[] = [];
    if (node.meta.artistNames?.length) contextParts.push(...node.meta.artistNames);
    if (node.meta.albumName) contextParts.push(node.meta.albumName);
    if (node.meta.genres) contextParts.push(...node.meta.genres);
    const haystack = normalizeName([node.label, ...contextParts].join(" "));

    let score = -1;
    if (label === q) score = 100;
    else if (label.startsWith(q)) score = 80;
    else if (label.includes(q)) score = 60;
    else if (haystack.includes(q)) score = 40;
    if (score < 0) continue;

    results.push({
      id: node.id,
      kind: node.kind,
      label: node.label,
      context: contextParts.slice(0, 2).join(" · "),
      listeningMs: node.listeningMs,
      score,
    });
  }

  results.sort(
    (a, b) => b.score - a.score || b.listeningMs - a.listeningMs || a.label.localeCompare(b.label),
  );
  return results.slice(0, limit);
}
