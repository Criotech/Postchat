import * as vscode from "vscode";
import type { ParsedCollection } from "../specParser/types";
import type { CollectionSource, ICollectionSource, SyncResult } from "./types";

const ACTIVE_SOURCE_KEY = "postchat.activeSourceId";
const SOURCE_METADATA_KEY = "postchat.sourceMetadata";

type CollectionChangeCallback = (collection: ParsedCollection) => void;

export class SourceRegistry implements vscode.Disposable {
  private readonly sources = new Map<string, ICollectionSource>();
  private activeSourceId: string | null = null;
  private readonly onChangeCallbacks: CollectionChangeCallback[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  // ─── REGISTRATION ──────────────────────────────────────────

  register(source: ICollectionSource): void {
    const info = source.getSourceInfo();
    if (this.sources.has(info.id)) {
      console.warn(`[Postchat] Source already registered: ${info.id}`);
      return;
    }
    this.sources.set(info.id, source);
  }

  unregister(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      return;
    }

    if (this.activeSourceId === sourceId) {
      void source.stopWatching();
      this.activeSourceId = null;
      void this.context.workspaceState.update(ACTIVE_SOURCE_KEY, undefined);
    }

    source.dispose();
    this.sources.delete(sourceId);
  }

  // ─── ACTIVATION ────────────────────────────────────────────

  async activate(sourceId: string): Promise<SyncResult> {
    const source = this.sources.get(sourceId);
    if (!source) {
      return { success: false, error: `Source not found: ${sourceId}`, isFirstSync: true };
    }

    // Stop previous active source watching
    if (this.activeSourceId && this.activeSourceId !== sourceId) {
      const previous = this.sources.get(this.activeSourceId);
      if (previous) {
        await previous.stopWatching();
      }
    }

    this.activeSourceId = sourceId;

    // Initial fetch
    const result = await source.fetch();

    if (result.success && result.collection) {
      this.notifyChange(result.collection);

      // Start watching for future changes
      await source.startWatching((watchResult: SyncResult) => {
        if (watchResult.success && watchResult.collection && this.activeSourceId === sourceId) {
          this.notifyChange(watchResult.collection);
        }
      });
    }

    // Persist active source for session restore
    await this.context.workspaceState.update(ACTIVE_SOURCE_KEY, sourceId);
    await this.context.workspaceState.update(SOURCE_METADATA_KEY, source.getSourceInfo().metadata);

    return result;
  }

  // ─── SESSION RESTORE ───────────────────────────────────────

  async restoreLastSession(): Promise<boolean> {
    const savedSourceId = this.context.workspaceState.get<string>(ACTIVE_SOURCE_KEY);
    if (!savedSourceId) {
      return false;
    }

    const source = this.sources.get(savedSourceId);
    if (!source) {
      void this.context.workspaceState.update(ACTIVE_SOURCE_KEY, undefined);
      void this.context.workspaceState.update(SOURCE_METADATA_KEY, undefined);
      return false;
    }

    const available = await source.isAvailable();
    if (!available) {
      console.warn(`[Postchat] Saved source "${savedSourceId}" is not available. Skipping restore.`);
      return false;
    }

    const result = await this.activate(savedSourceId);
    return result.success;
  }

  // ─── CHANGE LISTENERS ─────────────────────────────────────

  onCollectionChange(callback: CollectionChangeCallback): void {
    this.onChangeCallbacks.push(callback);
  }

  // ─── QUERIES ───────────────────────────────────────────────

  getAllSources(): CollectionSource[] {
    return Array.from(this.sources.values()).map((s) => s.getSourceInfo());
  }

  getActiveSource(): CollectionSource | null {
    if (!this.activeSourceId) {
      return null;
    }
    return this.sources.get(this.activeSourceId)?.getSourceInfo() ?? null;
  }

  async refreshActive(): Promise<SyncResult> {
    if (!this.activeSourceId) {
      return { success: false, error: "No active source", isFirstSync: false };
    }

    const source = this.sources.get(this.activeSourceId);
    if (!source) {
      return { success: false, error: "Active source not found", isFirstSync: false };
    }

    const result = await source.fetch();
    if (result.success && result.collection) {
      this.notifyChange(result.collection);
    }

    return result;
  }

  // ─── DISPOSAL ──────────────────────────────────────────────

  dispose(): void {
    for (const source of this.sources.values()) {
      try {
        void source.stopWatching();
        source.dispose();
      } catch (err) {
        console.error("[Postchat] Error disposing source:", err);
      }
    }
    this.sources.clear();
    this.activeSourceId = null;
    this.onChangeCallbacks.length = 0;
  }

  // ─── PRIVATE ───────────────────────────────────────────────

  private notifyChange(collection: ParsedCollection): void {
    for (const callback of this.onChangeCallbacks) {
      try {
        callback(collection);
      } catch (err) {
        console.error("[Postchat] Error in collection change callback:", err);
      }
    }
  }
}
