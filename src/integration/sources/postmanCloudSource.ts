import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseSpec } from "../../specParser";
import type { CollectionSource, ICollectionSource, SourceStatus, SyncResult } from "../types";

// ─── POSTMAN API TYPES ───────────────────────────────────────

export type PostmanWorkspace = {
  id: string;
  name: string;
  type: string;
};

export type PostmanCollectionMeta = {
  id: string;
  uid: string;
  name: string;
  owner: string;
  updatedAt: string;
};

// ─── POSTMAN API CLIENT ──────────────────────────────────────

export class PostmanApiClient {
  private readonly BASE_URL = "https://api.getpostman.com";

  constructor(private readonly apiKey: string) {}

  private async request<T>(urlPath: string): Promise<T> {
    const response = await fetch(this.BASE_URL + urlPath, {
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(15_000)
    });

    if (response.status === 401) {
      throw new Error("Invalid Postman API key. Check your settings.");
    }
    if (response.status === 429) {
      throw new Error("Postman API rate limit reached. Try again in a minute.");
    }
    if (!response.ok) {
      throw new Error(`Postman API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async getWorkspaces(): Promise<PostmanWorkspace[]> {
    const data = await this.request<{ workspaces: PostmanWorkspace[] }>("/workspaces");
    return data.workspaces;
  }

  async getCollections(workspaceId?: string): Promise<PostmanCollectionMeta[]> {
    const urlPath = workspaceId
      ? `/collections?workspace=${workspaceId}`
      : "/collections";
    const data = await this.request<{ collections: PostmanCollectionMeta[] }>(urlPath);
    return data.collections;
  }

  async getCollection(collectionId: string): Promise<unknown> {
    const data = await this.request<{ collection: unknown }>(`/collections/${collectionId}`);
    return data.collection;
  }

  async validateKey(): Promise<{ name: string; email: string }> {
    const data = await this.request<{ user: { fullName: string; email: string } }>("/me");
    return { name: data.user.fullName, email: data.user.email };
  }
}

// ─── HELPERS ─────────────────────────────────────────────────

function generateEtag(data: unknown): string {
  const json = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < json.length; i += 1) {
    hash = (hash << 5) - hash + json.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

async function writeTempJson(data: unknown): Promise<string> {
  const tmpDir = os.tmpdir();
  const tmpPath = path.join(tmpDir, `postchat-${Date.now()}.json`);
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  return tmpPath;
}

async function deleteTempFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore cleanup errors
  }
}

// ─── SOURCE CONFIGURATION ────────────────────────────────────

export type PostmanCloudConfig = {
  apiKey: string;
  collectionId: string;
  collectionName: string;
  workspaceName: string;
  pollIntervalMs: number;
};

// ─── SOURCE IMPLEMENTATION ───────────────────────────────────

export class PostmanCloudSource implements ICollectionSource {
  readonly sourceType = "postman_cloud" as const;

  private readonly client: PostmanApiClient;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastEtag: string | null = null;
  private lastSyncedAt: number | null = null;
  private status: SourceStatus = "disconnected";
  private errorMessage: string | undefined;

  constructor(private readonly config: PostmanCloudConfig) {
    this.client = new PostmanApiClient(config.apiKey);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.validateKey();
      return true;
    } catch {
      return false;
    }
  }

  async fetch(): Promise<SyncResult> {
    try {
      this.status = "syncing";

      const rawCollection = await this.client.getCollection(this.config.collectionId);

      // Write to temp file so we can reuse the existing Postman parser
      const tmpPath = await writeTempJson(rawCollection);
      let collection;
      try {
        collection = await parseSpec(tmpPath);
      } finally {
        await deleteTempFile(tmpPath);
      }

      // Detect changes via lightweight hash
      const currentEtag = generateEtag(rawCollection);
      const isFirstSync = this.lastEtag === null;
      const hasChanges = this.lastEtag !== currentEtag;
      this.lastEtag = currentEtag;
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
      return { success: false, error: message, isFirstSync: this.lastEtag === null };
    }
  }

  async startWatching(onUpdate: (result: SyncResult) => void): Promise<void> {
    if (this.config.pollIntervalMs <= 0) {
      return; // Manual-only mode
    }

    this.pollTimer = setInterval(async () => {
      const previousEtag = this.lastEtag;
      const result = await this.fetch();

      // Only notify if something actually changed
      if (result.success && this.lastEtag !== previousEtag) {
        onUpdate(result);
      }
    }, this.config.pollIntervalMs);
  }

  async stopWatching(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getSourceInfo(): CollectionSource {
    return {
      id: "postman_cloud_" + this.config.collectionId,
      type: "postman_cloud",
      label: this.config.collectionName,
      description: `${this.config.workspaceName} \u00b7 Postman Cloud`,
      status: this.status,
      lastSyncedAt: this.lastSyncedAt,
      autoSync: this.config.pollIntervalMs > 0,
      syncIntervalMs: this.config.pollIntervalMs,
      metadata: {
        collectionId: this.config.collectionId,
        workspaceName: this.config.workspaceName
      },
      errorMessage: this.errorMessage
    };
  }

  dispose(): void {
    void this.stopWatching();
  }
}
