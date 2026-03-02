import type { ParsedCollection } from "../specParser/types";

// ─── SOURCE TYPE & STATUS ────────────────────────────────────

export type SourceType =
  | "postman_cloud"
  | "workspace_file"
  | "url_import"
  | "watched_file"
  | "git_tracked";

export type SourceStatus =
  | "connected"
  | "syncing"
  | "disconnected"
  | "error"
  | "stale";

// ─── SOURCE DESCRIPTOR ───────────────────────────────────────

export type CollectionSource = {
  id: string;
  type: SourceType;
  label: string;
  description: string;
  status: SourceStatus;
  lastSyncedAt: number | null;
  autoSync: boolean;
  syncIntervalMs?: number;
  metadata: Record<string, string>;
  errorMessage?: string;
};

// ─── SYNC RESULT ─────────────────────────────────────────────

export type SyncResult = {
  success: boolean;
  collection?: ParsedCollection;
  error?: string;
  changedEndpoints?: number;
  isFirstSync: boolean;
};

// ─── SOURCE PLUGIN INTERFACE ─────────────────────────────────

export interface ICollectionSource {
  readonly sourceType: SourceType;

  /** Check if this source can operate (e.g. credentials present, file exists) */
  isAvailable(): Promise<boolean>;

  /** Fetch the collection data from this source */
  fetch(): Promise<SyncResult>;

  /** Start watching for changes (e.g. file watcher, polling timer) */
  startWatching(onUpdate: (result: SyncResult) => void): Promise<void>;

  /** Stop watching for changes */
  stopWatching(): Promise<void>;

  /** Return the current source descriptor for UI display */
  getSourceInfo(): CollectionSource;

  /** Clean up all resources */
  dispose(): void;
}
