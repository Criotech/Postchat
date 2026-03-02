import * as path from "node:path";
import * as vscode from "vscode";
import { detectSpecType } from "../../specParser/detector";
import { parseSpec } from "../../specParser";
import type { SpecType } from "../../specParser/types";
import type { CollectionSource, ICollectionSource, SourceStatus, SyncResult } from "../types";
import type { SourceRegistry } from "../sourceRegistry";

// ─── EXCLUDE PATTERNS ────────────────────────────────────────

const EXCLUDE_PATTERN =
  "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.next/**,**/.nuxt/**}";

// ─── SEARCH GLOBS (priority order) ──────────────────────────

const SEARCH_GLOBS: string[] = [
  // Priority 1 — Explicit Postman exports
  "**/*.postman_collection.json",

  // Priority 2 — Common API spec filenames
  "**/openapi.{yaml,yml,json}",
  "**/swagger.{yaml,yml,json}",
  "**/api.{yaml,yml,json}",
  "**/api-spec.{yaml,yml,json}",
  "**/api-docs.{yaml,yml,json}",

  // Priority 3 — Common folder locations
  "**/docs/api*.{yaml,yml,json}",
  "**/api/docs/*.{yaml,yml,json}",
  "**/.postman/*.json",
  "**/postman/*.json",
  "**/collections/*.json"
];

// ─── CONFIDENCE SCORING ──────────────────────────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_SIZE = 100 * 1024;      // 100 KB
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

async function scoreCandidate(uri: vscode.Uri): Promise<number> {
  let score = 0;
  const lower = uri.fsPath.toLowerCase();
  const fileName = path.basename(lower);

  if (fileName.includes("postman")) {
    score += 40;
  }
  if (fileName.includes("collection")) {
    score += 30;
  }
  if (fileName.includes("openapi") || fileName.includes("swagger")) {
    score += 40;
  }

  const dir = path.dirname(lower);
  if (/[/\\](docs|api)[/\\]?/i.test(dir)) {
    score += 20;
  }

  // Root-level = only one path segment below the workspace folder
  const rel = vscode.workspace.asRelativePath(uri, false);
  if (!rel.includes(path.sep) && !rel.includes("/")) {
    score += 10;
  }

  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MIN_SIZE && stat.size < MAX_SIZE) {
      score += 10;
    }
    if (Date.now() - stat.mtime < SEVEN_DAYS_MS) {
      score += 20;
    }
  } catch {
    // stat failed — skip these bonuses
  }

  return score;
}

// ─── AUTO DETECTOR ───────────────────────────────────────────

export type DetectedSpec = {
  path: string;
  specType: SpecType;
  score: number;
};

export async function detectCollectionsInWorkspace(): Promise<DetectedSpec[]> {
  // Search all globs in parallel, then deduplicate by fsPath
  const searchResults = await Promise.all(
    SEARCH_GLOBS.map((glob) =>
      vscode.workspace.findFiles(glob, EXCLUDE_PATTERN, 50)
    )
  );

  const seen = new Set<string>();
  const uniqueUris: vscode.Uri[] = [];
  for (const uris of searchResults) {
    for (const uri of uris) {
      if (!seen.has(uri.fsPath)) {
        seen.add(uri.fsPath);
        uniqueUris.push(uri);
      }
    }
  }

  // Verify each candidate with detectSpecType and score in parallel
  const results = await Promise.all(
    uniqueUris.map(async (uri): Promise<DetectedSpec | null> => {
      try {
        const specType = await detectSpecType(uri.fsPath);
        if (specType === "unknown") {
          return null;
        }
        const score = await scoreCandidate(uri);
        return { path: uri.fsPath, specType, score };
      } catch {
        return null;
      }
    })
  );

  return results
    .filter((r): r is DetectedSpec => r !== null)
    .sort((a, b) => b.score - a.score);
}

// ─── HELPERS ─────────────────────────────────────────────────

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ─── SOURCE IMPLEMENTATION ───────────────────────────────────

export class WorkspaceSource implements ICollectionSource {
  readonly sourceType = "workspace_file" as const;

  private watcher: vscode.FileSystemWatcher | null = null;
  private status: SourceStatus = "disconnected";
  private lastModifiedTime = 0;
  private errorMessage: string | undefined;

  constructor(private readonly filePath: string) {}

  async isAvailable(): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(this.filePath));
      return true;
    } catch {
      return false;
    }
  }

  async fetch(): Promise<SyncResult> {
    try {
      this.status = "syncing";

      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(this.filePath));
      const isFirstSync = this.lastModifiedTime === 0;
      const hasChanges = stat.mtime > this.lastModifiedTime;
      this.lastModifiedTime = stat.mtime;

      if (!isFirstSync && !hasChanges) {
        this.status = "connected";
        return { success: true, isFirstSync: false, changedEndpoints: 0 };
      }

      const collection = await parseSpec(this.filePath);

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
      return { success: false, error: message, isFirstSync: this.lastModifiedTime === 0 };
    }
  }

  async startWatching(onUpdate: (result: SyncResult) => void): Promise<void> {
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(this.filePath)),
        path.basename(this.filePath)
      )
    );

    // Debounce to avoid multiple rapid updates on save
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const handleChange = (): void => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(async () => {
        const result = await this.fetch();
        if (result.success && result.collection) {
          onUpdate(result);
        }
      }, 500);
    };

    this.watcher.onDidChange(handleChange);
    this.watcher.onDidCreate(handleChange);
    this.watcher.onDidDelete(() => {
      this.status = "error";
      this.errorMessage = "Collection file was deleted";
      onUpdate({
        success: false,
        error: "Collection file was deleted",
        isFirstSync: false
      });
    });
  }

  async stopWatching(): Promise<void> {
    this.watcher?.dispose();
    this.watcher = null;
  }

  getSourceInfo(): CollectionSource {
    const fileName = path.basename(this.filePath);
    const relPath = vscode.workspace.asRelativePath(this.filePath);
    return {
      id: "workspace_" + hashString(this.filePath),
      type: "workspace_file",
      label: fileName,
      description: `${relPath} \u00b7 Live file watch`,
      status: this.status,
      lastSyncedAt: this.lastModifiedTime || null,
      autoSync: true,
      metadata: { filePath: this.filePath },
      errorMessage: this.errorMessage
    };
  }

  dispose(): void {
    void this.stopWatching();
  }
}

// ─── AUTO-DETECT AND REGISTER ────────────────────────────────

export async function autoDetectAndRegister(
  registry: SourceRegistry
): Promise<boolean> {
  const candidates = await detectCollectionsInWorkspace();

  if (candidates.length === 0) {
    return false;
  }

  if (candidates.length === 1) {
    // Only one found — auto-load silently
    const source = new WorkspaceSource(candidates[0].path);
    registry.register(source);
    await registry.activate(source.getSourceInfo().id);

    const fileName = path.basename(candidates[0].path);
    void vscode.window.showInformationMessage(
      `Postchat: Auto-loaded ${fileName}`,
      "Dismiss"
    );
    return true;
  }

  if (candidates.length <= 8) {
    // Multiple found — let user pick via QuickPick
    const pick = await vscode.window.showQuickPick(
      candidates.map((c) => ({
        label: path.basename(c.path),
        description: vscode.workspace.asRelativePath(c.path),
        detail: `${c.specType} \u00b7 Confidence: ${c.score}%`,
        filePath: c.path
      })),
      {
        title: "Postchat found multiple API specs \u2014 select one to load",
        placeHolder: "Select a collection or spec file"
      }
    );

    if (pick) {
      const source = new WorkspaceSource(pick.filePath);
      registry.register(source);
      await registry.activate(source.getSourceInfo().id);
      return true;
    }
  }

  // More than 8 candidates — too noisy, skip auto-detect
  return false;
}
