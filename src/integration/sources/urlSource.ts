import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { parseSpec } from "../../specParser";
import type { CollectionSource, ICollectionSource, SourceStatus, SyncResult } from "../types";

// ─── HELPERS ─────────────────────────────────────────────────

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

async function writeTempFile(content: string, ext: string): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `postchat-url-${Date.now()}${ext}`);
  await fs.writeFile(tmpPath, content, "utf8");
  return tmpPath;
}

async function deleteTempFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore cleanup errors
  }
}

// ─── URL RESOLVER ────────────────────────────────────────────

export type ResolvedUrl = {
  resolvedUrl: string;
  sourceHint: string;
};

export async function resolveUrl(rawUrl: string): Promise<ResolvedUrl> {
  const trimmed = rawUrl.trim();

  // GitHub blob URLs → raw.githubusercontent.com
  if (trimmed.includes("github.com") && trimmed.includes("/blob/")) {
    const resolvedUrl = trimmed
      .replace("github.com", "raw.githubusercontent.com")
      .replace("/blob/", "/");
    return { resolvedUrl, sourceHint: "GitHub" };
  }

  // GitLab raw URLs — already raw, just tag the hint
  if (trimmed.includes("gitlab.com") && trimmed.includes("/-/raw/")) {
    return { resolvedUrl: trimmed, sourceHint: "GitLab" };
  }

  // Postman public collection share links
  if (
    trimmed.includes("postman.com/collection") ||
    trimmed.includes("getpostman.com/collections")
  ) {
    // These URLs redirect to JSON — follow redirects via a HEAD check
    try {
      const response = await fetch(trimmed, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(10_000)
      });
      return { resolvedUrl: response.url, sourceHint: "Postman Share Link" };
    } catch {
      // Fall through to use as-is if HEAD fails
      return { resolvedUrl: trimmed, sourceHint: "Postman Share Link" };
    }
  }

  // All other URLs — extract hostname as hint
  let sourceHint: string;
  try {
    const parsed = new URL(trimmed);
    sourceHint = parsed.hostname;
  } catch {
    sourceHint = "URL";
  }

  return { resolvedUrl: trimmed, sourceHint };
}

// ─── SOURCE CONFIGURATION ────────────────────────────────────

export type UrlSourceConfig = {
  url: string;
  resolvedUrl: string;
  sourceHint: string;
  autoRefresh: boolean;
  refreshIntervalMs: number;
};

// ─── SOURCE IMPLEMENTATION ───────────────────────────────────

export class UrlSource implements ICollectionSource {
  readonly sourceType = "url_import" as const;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastContentHash: string | null = null;
  private lastSyncedAt: number | null = null;
  private status: SourceStatus = "disconnected";
  private errorMessage: string | undefined;

  constructor(private readonly config: UrlSourceConfig) {}

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(this.config.resolvedUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(5_000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async fetch(): Promise<SyncResult> {
    try {
      this.status = "syncing";

      const response = await fetch(this.config.resolvedUrl, {
        signal: AbortSignal.timeout(30_000),
        headers: { Accept: "application/json, application/yaml, text/yaml, */*" }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      const text = await response.text();

      // Check if content changed
      const contentHash = hashString(text);
      const isFirstSync = this.lastContentHash === null;
      const hasChanges = this.lastContentHash !== contentHash;
      this.lastContentHash = contentHash;
      this.lastSyncedAt = Date.now();

      if (!isFirstSync && !hasChanges) {
        this.status = "connected";
        return { success: true, isFirstSync: false, changedEndpoints: 0 };
      }

      // Write to temp file and parse through existing pipeline
      const ext = contentType.includes("yaml") || contentType.includes("yml")
        ? ".yaml"
        : ".json";
      const tmpPath = await writeTempFile(text, ext);
      let collection;
      try {
        collection = await parseSpec(tmpPath);
      } finally {
        await deleteTempFile(tmpPath);
      }

      this.status = "connected";
      this.errorMessage = undefined;

      return {
        success: true,
        collection,
        isFirstSync,
        changedEndpoints: hasChanges ? -1 : 0
      };
    } catch (error: unknown) {
      this.status = "error";
      const message = error instanceof Error ? error.message : String(error);
      this.errorMessage = message;
      return { success: false, error: message, isFirstSync: this.lastContentHash === null };
    }
  }

  async startWatching(onUpdate: (result: SyncResult) => void): Promise<void> {
    if (!this.config.autoRefresh || this.config.refreshIntervalMs <= 0) {
      return;
    }

    this.pollTimer = setInterval(async () => {
      const prevHash = this.lastContentHash;
      const result = await this.fetch();

      if (result.success && this.lastContentHash !== prevHash) {
        onUpdate(result);
      }
    }, this.config.refreshIntervalMs);
  }

  async stopWatching(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getSourceInfo(): CollectionSource {
    return {
      id: "url_" + hashString(this.config.resolvedUrl),
      type: "url_import",
      label: this.config.sourceHint,
      description: this.config.resolvedUrl,
      status: this.status,
      lastSyncedAt: this.lastSyncedAt,
      autoSync: this.config.autoRefresh,
      syncIntervalMs: this.config.refreshIntervalMs,
      metadata: {
        url: this.config.url,
        resolvedUrl: this.config.resolvedUrl,
        sourceHint: this.config.sourceHint
      },
      errorMessage: this.errorMessage
    };
  }

  dispose(): void {
    void this.stopWatching();
  }
}

// ─── URL SETUP FLOW ──────────────────────────────────────────

export async function setupUrlSource(): Promise<UrlSource | null> {

  // ─── Step 1: Get URL ──────────────────────────────────────

  const rawUrl = await vscode.window.showInputBox({
    title: "Load Collection from URL",
    prompt: "Enter the URL of your API spec or Postman collection",
    placeHolder: "https://api.example.com/openapi.json",
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
        return "Must be a valid URL starting with http:// or https://";
      }
      return null;
    }
  });

  if (!rawUrl) {
    return null;
  }

  // ─── Step 2: Resolve and validate ─────────────────────────

  const fetchResult = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Fetching spec from URL..." },
    async () => {
      const resolved = await resolveUrl(rawUrl);

      const response = await fetch(resolved.resolvedUrl, {
        signal: AbortSignal.timeout(30_000),
        headers: { Accept: "application/json, application/yaml, text/yaml, */*" }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      const text = await response.text();

      const ext = contentType.includes("yaml") || contentType.includes("yml")
        ? ".yaml"
        : ".json";
      const tmpPath = await writeTempFile(text, ext);
      let collection;
      try {
        collection = await parseSpec(tmpPath);
      } finally {
        await deleteTempFile(tmpPath);
      }

      return { resolved, collection };
    }
  ).then(
    (result) => ({ ok: true as const, ...result }),
    (error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error)
    })
  );

  if (!fetchResult.ok) {
    void vscode.window.showErrorMessage(`Postchat: Failed to fetch spec \u2014 ${fetchResult.error}`);
    return null;
  }

  const { resolved, collection } = fetchResult;

  void vscode.window.showInformationMessage(
    `Found: ${collection.title} (${collection.endpoints.length} endpoints) \u00b7 ${collection.specType}`
  );

  // ─── Step 3: Configure auto-refresh ───────────────────────

  const intervalItems: (vscode.QuickPickItem & { value: number })[] = [
    { label: "Every minute", description: "Good for local dev servers", value: 60_000 },
    { label: "Every 5 minutes", description: "Good for staging APIs", value: 300_000 },
    { label: "Every hour", description: "Good for stable hosted APIs", value: 3_600_000 },
    { label: "Manual only", description: "Refresh only when you click refresh", value: 0 }
  ];

  const selectedInterval = await vscode.window.showQuickPick(intervalItems, {
    title: "Auto-refresh this URL?",
    placeHolder: "Choose a refresh interval",
    ignoreFocusOut: true
  });

  if (!selectedInterval) {
    return null;
  }

  // ─── Step 4: Create and return the source ─────────────────

  return new UrlSource({
    url: rawUrl.trim(),
    resolvedUrl: resolved.resolvedUrl,
    sourceHint: resolved.sourceHint,
    autoRefresh: selectedInterval.value > 0,
    refreshIntervalMs: selectedInterval.value
  });
}
