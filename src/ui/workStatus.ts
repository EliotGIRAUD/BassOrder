export type WorkJob = {
  id: string;
  label: string;
  detail?: string;
  done?: number;
  total?: number;
};

const jobs = new Map<string, WorkJob>();
const listeners = new Set<() => void>();
let snapshot: WorkJob[] = [];

function rebuildSnapshot() {
  snapshot = [...jobs.values()];
}

function emit() {
  rebuildSnapshot();
  listeners.forEach((handler) => handler());
}

export function setWorkJob(
  id: string,
  label: string,
  detail?: string,
  metrics?: { done: number; total: number },
): void {
  const prev = jobs.get(id);
  const next: WorkJob = {
    id,
    label,
    detail,
    done: metrics?.done,
    total: metrics?.total,
  };
  if (
    prev &&
    prev.label === next.label &&
    prev.detail === next.detail &&
    prev.done === next.done &&
    prev.total === next.total
  ) {
    return;
  }
  jobs.set(id, next);
  emit();
}

export function clearWorkJob(id: string): void {
  if (!jobs.has(id)) {
    return;
  }
  jobs.delete(id);
  emit();
}

/** Snapshot stable pour useSyncExternalStore (même référence tant que rien ne change). */
export function listWorkJobs(): WorkJob[] {
  return snapshot;
}

export function getWorkJob(id: string): WorkJob | null {
  return jobs.get(id) ?? null;
}

export function subscribeWork(handler: () => void): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

export function workViewForJob(id: string): "local" | "spotify" {
  return id.startsWith("spotify") ? "spotify" : "local";
}

export function shortJobLabel(id: string, label: string): string {
  if (id.startsWith("spotify-enrich")) return "Complément";
  if (id.startsWith("spotify-sync")) return "Likes";
  if (id.startsWith("spotify-connect")) return "Lien";
  if (id.startsWith("local-scan")) return "Analyse";
  if (id.startsWith("local-lookup")) return "Genres";
  if (id.startsWith("local-organize")) return "Disque";
  return label.length > 10 ? `${label.slice(0, 9)}…` : label;
}
