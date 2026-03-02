import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { parseSpec } from "../../specParser";
import type { ParsedCollection } from "../../specParser/types";
import type { CollectionSource, ICollectionSource, SourceStatus, SyncResult } from "../types";

// ─── VS CODE GIT EXTENSION TYPES ─────────────────────────────
// Minimal type surface for the built-in vscode.git extension API (v1).
// Full typings live in vscode's own repo; we only declare what we use.

interface GitExtensionApi {
  getAPI(version: 1): GitApi;
}

interface GitApi {
  repositories: GitRepository[];
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: GitRepositoryState;
  log(options?: { maxEntries?: number; path?: string }): Promise<GitLogEntry[]>;
  show(ref: string, filePath: string): Promise<string>;
  diff(cached?: boolean): Promise<string>;
}

interface GitRepositoryState {
  HEAD: { name?: string; commit?: string } | undefined;
  onDidChange: vscode.Event<void>;
}

interface GitLogEntry {
  hash: string;
  message: string;
  authorName?: string;
  authorDate?: Date;
}

// ─── PUBLIC TYPES ────────────────────────────────────────────

export type GitCommit = {
  hash: string;
  message: string;
  author: string;
  date: Date | null;
};

// ─── GIT CLIENT ──────────────────────────────────────────────

class GitClient {
  private repo: GitRepository | null = null;

  async init(): Promise<boolean> {
    if (this.repo) {
      return true;
    }

    const gitExtension = vscode.extensions.getExtension<GitExtensionApi>("vscode.git");
    if (!gitExtension) {
      return false;
    }

    if (!gitExtension.isActive) {
      await gitExtension.activate();
    }

    const api = gitExtension.exports.getAPI(1);
    if (api.repositories.length === 0) {
      return false;
    }

    this.repo = api.repositories[0];
    return true;
  }

  getRepo(): GitRepository | null {
    return this.repo;
  }

  getCurrentBranch(): string {
    return this.repo?.state.HEAD?.name ?? "unknown";
  }

  getCurrentCommit(): string | null {
    return this.repo?.state.HEAD?.commit ?? null;
  }

  async getFileAtCommit(filePath: string, ref: string): Promise<string> {
    if (!this.repo) {
      throw new Error("Git repository not initialized");
    }

    // repo.show() returns file contents at the given ref
    const relativePath = path.relative(this.repo.rootUri.fsPath, filePath);
    return this.repo.show(ref, relativePath);
  }

  async getRecentCommitsForFile(filePath: string, limit: number = 10): Promise<GitCommit[]> {
    if (!this.repo) {
      return [];
    }

    try {
      const relativePath = path.relative(this.repo.rootUri.fsPath, filePath);
      const entries = await this.repo.log({ maxEntries: limit, path: relativePath });
      return entries.map((entry) => ({
        hash: entry.hash,
        message: entry.message,
        author: entry.authorName ?? "unknown",
        date: entry.authorDate ?? null
      }));
    } catch {
      return [];
    }
  }

  async getFileDiff(
    filePath: string,
    fromRef: string,
    toRef: string
  ): Promise<{ added: number; removed: number; changed: boolean }> {
    if (!this.repo) {
      return { added: 0, removed: 0, changed: false };
    }

    try {
      const relativePath = path.relative(this.repo.rootUri.fsPath, filePath);
      // Use child_process via VS Code's terminal to run git diff --numstat
      const result = await new Promise<string>((resolve, reject) => {
        const { exec } = require("node:child_process") as typeof import("node:child_process");
        exec(
          `git diff --numstat ${fromRef} ${toRef} -- "${relativePath}"`,
          { cwd: this.repo!.rootUri.fsPath },
          (error: Error | null, stdout: string) => {
            if (error) {
              reject(error);
            } else {
              resolve(stdout.trim());
            }
          }
        );
      });

      if (!result) {
        return { added: 0, removed: 0, changed: false };
      }

      // numstat format: "added\tremoved\tfilepath"
      const parts = result.split("\t");
      const added = parseInt(parts[0], 10) || 0;
      const removed = parseInt(parts[1], 10) || 0;
      return { added, removed, changed: added > 0 || removed > 0 };
    } catch {
      return { added: 0, removed: 0, changed: false };
    }
  }

  onRepositoryChange(callback: () => void): vscode.Disposable | null {
    if (!this.repo) {
      return null;
    }
    return this.repo.state.onDidChange(callback);
  }
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

async function writeTempFile(content: string, ext: string): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `postchat-git-${Date.now()}${ext}`);
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

// ─── SOURCE IMPLEMENTATION ───────────────────────────────────

export class GitTrackedSource implements ICollectionSource {
  readonly sourceType = "git_tracked" as const;

  private readonly gitClient = new GitClient();
  private changeDisposable: vscode.Disposable | null = null;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private lastCommitHash: string | null = null;
  private lastSyncedAt: number | null = null;
  private status: SourceStatus = "disconnected";
  private errorMessage: string | undefined;

  constructor(
    private readonly filePath: string,
    private readonly watchRef: string = "HEAD"
  ) {}

  async isAvailable(): Promise<boolean> {
    const gitOk = await this.gitClient.init();
    if (!gitOk) {
      return false;
    }

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(this.filePath));
      return true;
    } catch {
      return false;
    }
  }

  async fetch(): Promise<SyncResult> {
    try {
      await this.gitClient.init();
      this.status = "syncing";

      // Parse the working tree copy of the file
      const collection = await parseSpec(this.filePath);

      // Track commit hash for change detection on git operations
      const currentHash = this.gitClient.getCurrentCommit();
      const isFirstSync = this.lastCommitHash === null;
      const hasChanges = this.lastCommitHash !== currentHash;
      this.lastCommitHash = currentHash;
      this.lastSyncedAt = Date.now();

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
      return { success: false, error: message, isFirstSync: this.lastCommitHash === null };
    }
  }

  async startWatching(onUpdate: (result: SyncResult) => void): Promise<void> {
    await this.gitClient.init();

    // Debounced handler shared by both watchers
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const handleChange = (): void => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(async () => {
        const prevHash = this.lastCommitHash;
        const result = await this.fetch();

        if (result.success && result.collection) {
          // Only notify if git commit changed or file was edited
          if (this.lastCommitHash !== prevHash || result.isFirstSync) {
            onUpdate(result);
          } else {
            // File may have changed on disk without a new commit
            onUpdate(result);
          }
        }
      }, 500);
    };

    // Watch for Git state changes (commits, branch switches, pulls, rebases)
    this.changeDisposable = this.gitClient.onRepositoryChange(handleChange);

    // Also watch the file on disk for saves between commits
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(this.filePath)),
        path.basename(this.filePath)
      )
    );
    this.fileWatcher.onDidChange(handleChange);
    this.fileWatcher.onDidCreate(handleChange);
    this.fileWatcher.onDidDelete(() => {
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
    this.changeDisposable?.dispose();
    this.changeDisposable = null;
    this.fileWatcher?.dispose();
    this.fileWatcher = null;
  }

  // ─── GIT-SPECIFIC EXTRAS ──────────────────────────────────

  async fetchAtCommit(commitHash: string): Promise<ParsedCollection> {
    await this.gitClient.init();
    const content = await this.gitClient.getFileAtCommit(this.filePath, commitHash);

    const ext = this.filePath.endsWith(".yaml") || this.filePath.endsWith(".yml")
      ? ".yaml"
      : ".json";
    const tmpPath = await writeTempFile(content, ext);
    let collection;
    try {
      collection = await parseSpec(tmpPath);
    } finally {
      await deleteTempFile(tmpPath);
    }
    return collection;
  }

  async getChangeHistory(): Promise<GitCommit[]> {
    await this.gitClient.init();
    return this.gitClient.getRecentCommitsForFile(this.filePath, 20);
  }

  async getDiffStats(
    fromRef: string,
    toRef: string
  ): Promise<{ added: number; removed: number; changed: boolean }> {
    await this.gitClient.init();
    return this.gitClient.getFileDiff(this.filePath, fromRef, toRef);
  }

  getCurrentBranch(): string {
    return this.gitClient.getCurrentBranch();
  }

  // ─── ICollectionSource ─────────────────────────────────────

  getSourceInfo(): CollectionSource {
    const relPath = vscode.workspace.asRelativePath(this.filePath);
    const branch = this.gitClient.getCurrentBranch();
    return {
      id: "git_" + hashString(this.filePath),
      type: "git_tracked",
      label: path.basename(this.filePath),
      description: `${relPath} \u00b7 Git tracked (${branch})`,
      status: this.status,
      lastSyncedAt: this.lastSyncedAt,
      autoSync: true,
      metadata: {
        filePath: this.filePath,
        watchRef: this.watchRef,
        branch
      },
      errorMessage: this.errorMessage
    };
  }

  dispose(): void {
    void this.stopWatching();
  }
}

// ─── SETUP FLOW ──────────────────────────────────────────────

export async function setupGitSource(): Promise<GitTrackedSource | null> {
  // Verify Git is available
  const gitExtension = vscode.extensions.getExtension<GitExtensionApi>("vscode.git");
  if (!gitExtension) {
    void vscode.window.showErrorMessage(
      "Postchat: The Git extension is not available. Install it from the VS Code marketplace."
    );
    return null;
  }

  if (!gitExtension.isActive) {
    await gitExtension.activate();
  }

  const api = gitExtension.exports.getAPI(1);
  if (api.repositories.length === 0) {
    void vscode.window.showErrorMessage(
      "Postchat: No Git repository found in this workspace."
    );
    return null;
  }

  const repo = api.repositories[0];

  // Step 1 — Pick a collection file from the workspace
  const fileUris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    defaultUri: repo.rootUri,
    title: "Select an API collection or spec file to track with Git",
    filters: {
      "API Specs": ["json", "yaml", "yml"]
    }
  });

  if (!fileUris || fileUris.length === 0) {
    return null;
  }

  const filePath = fileUris[0].fsPath;

  // Verify the file is inside the Git repo
  const repoRoot = repo.rootUri.fsPath;
  if (!filePath.startsWith(repoRoot)) {
    void vscode.window.showErrorMessage(
      "Postchat: Selected file is not inside the current Git repository."
    );
    return null;
  }

  // Verify it parses as a valid spec
  const parseResult = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Validating spec file..." },
    async () => {
      try {
        const collection = await parseSpec(filePath);
        return { ok: true as const, collection };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false as const, error: message };
      }
    }
  );

  if (!parseResult.ok) {
    void vscode.window.showErrorMessage(`Postchat: ${parseResult.error}`);
    return null;
  }

  const { collection } = parseResult;

  // Show file info and git history
  const client = new GitClient();
  await client.init();
  const commits = await client.getRecentCommitsForFile(filePath, 5);
  const branch = client.getCurrentBranch();

  const historyDetail = commits.length > 0
    ? `Last commit: "${commits[0].message.split("\n")[0]}" by ${commits[0].author}`
    : "No Git history for this file yet";

  const confirm = await vscode.window.showInformationMessage(
    `Track "${collection.title}" (${collection.endpoints.length} endpoints) on branch "${branch}"?\n${historyDetail}`,
    { modal: true },
    "Track with Git"
  );

  if (confirm !== "Track with Git") {
    return null;
  }

  return new GitTrackedSource(filePath);
}
