import * as vscode from "vscode";
import {
  PostmanApiClient,
  PostmanCloudSource,
  type PostmanCloudConfig
} from "./postmanCloudSource";

const SECRET_KEY = "postchat.postmanApiKey";
const API_KEYS_URL = "https://go.postman.co/settings/me/api-keys";

// ─── SETUP FLOW ──────────────────────────────────────────────

export async function setupPostmanCloud(
  context: vscode.ExtensionContext
): Promise<PostmanCloudSource | null> {

  // ─── Step 1: Get & validate API key ────────────────────────

  const apiKey = await promptForApiKey(context);
  if (!apiKey) {
    return null;
  }

  const client = new PostmanApiClient(apiKey);

  // ─── Step 2: Pick workspace ────────────────────────────────

  const workspaces = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Fetching Postman workspaces..." },
    () => client.getWorkspaces()
  );

  if (!workspaces || workspaces.length === 0) {
    void vscode.window.showWarningMessage("Postchat: No workspaces found in your Postman account.");
    return null;
  }

  const workspaceItems = workspaces.map((w) => ({
    label: w.name,
    description: w.type,
    workspaceId: w.id
  }));

  const selectedWorkspace = await vscode.window.showQuickPick(workspaceItems, {
    title: "Select a Postman Workspace",
    placeHolder: "Choose a workspace",
    ignoreFocusOut: true
  });

  if (!selectedWorkspace) {
    return null;
  }

  // ─── Step 3: Pick collection ───────────────────────────────

  const collections = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Fetching collections..." },
    () => client.getCollections(selectedWorkspace.workspaceId)
  );

  if (!collections || collections.length === 0) {
    void vscode.window.showWarningMessage(
      `Postchat: No collections found in workspace "${selectedWorkspace.label}".`
    );
    return null;
  }

  const collectionItems = collections.map((c) => ({
    label: c.name,
    description: c.uid,
    detail: `Last updated: ${formatDate(c.updatedAt)}`,
    collectionUid: c.uid
  }));

  const selectedCollection = await vscode.window.showQuickPick(collectionItems, {
    title: "Select a Collection",
    placeHolder: "Choose a collection to sync",
    ignoreFocusOut: true
  });

  if (!selectedCollection) {
    return null;
  }

  // ─── Step 4: Pick sync interval ────────────────────────────

  const intervalItems: (vscode.QuickPickItem & { value: number })[] = [
    { label: "Every 30 seconds", description: "Real-time sync", value: 30_000 },
    { label: "Every 2 minutes", description: "Balanced", value: 120_000 },
    { label: "Every 5 minutes", description: "Low frequency", value: 300_000 },
    { label: "Manual only", description: "No auto-sync", value: 0 }
  ];

  const selectedInterval = await vscode.window.showQuickPick(intervalItems, {
    title: "How often should Postchat check for updates?",
    placeHolder: "Choose a sync interval",
    ignoreFocusOut: true
  });

  if (!selectedInterval) {
    return null;
  }

  // ─── Step 5: Create and return the source ──────────────────

  const config: PostmanCloudConfig = {
    apiKey,
    collectionId: selectedCollection.collectionUid,
    collectionName: selectedCollection.label,
    workspaceName: selectedWorkspace.label,
    pollIntervalMs: selectedInterval.value
  };

  return new PostmanCloudSource(config);
}

// ─── HELPERS ─────────────────────────────────────────────────

async function promptForApiKey(
  context: vscode.ExtensionContext
): Promise<string | null> {
  // Check for a previously stored key
  const existingKey = await context.secrets.get(SECRET_KEY);
  if (existingKey) {
    const reuse = await vscode.window.showQuickPick(
      [
        { label: "Use saved API key", description: "From previous connection", value: "reuse" as const },
        { label: "Enter a new key", description: "Replace the saved key", value: "new" as const }
      ],
      { title: "Postman API Key", ignoreFocusOut: true }
    );

    if (!reuse) {
      return null;
    }
    if (reuse.value === "reuse") {
      // Validate the saved key still works
      const valid = await validateApiKey(existingKey);
      if (valid) {
        return existingKey;
      }
      void vscode.window.showWarningMessage("Postchat: Saved API key is no longer valid. Please enter a new one.");
    }
  }

  // Offer to open the API keys page
  const openBrowser = await vscode.window.showInformationMessage(
    "You'll need a Postman API key. Open the Postman settings page to create one?",
    "Open Postman Settings",
    "I already have one"
  );

  if (openBrowser === "Open Postman Settings") {
    void vscode.env.openExternal(vscode.Uri.parse(API_KEYS_URL));
  }

  if (!openBrowser) {
    return null;
  }

  // Prompt for the key
  const apiKey = await vscode.window.showInputBox({
    prompt: "Enter your Postman API Key",
    placeHolder: "PMAK-...",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) {
        return "API key cannot be empty";
      }
      return null;
    }
  });

  if (!apiKey) {
    return null;
  }

  // Validate
  const valid = await validateApiKey(apiKey);
  if (!valid) {
    return null;
  }

  // Store securely
  await context.secrets.store(SECRET_KEY, apiKey);

  return apiKey;
}

async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const client = new PostmanApiClient(apiKey);
    const user = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Validating API key..." },
      () => client.validateKey()
    );
    void vscode.window.showInformationMessage(
      `Postchat: Connected as ${user.name} (${user.email})`
    );
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Postchat: ${message}`);
    return false;
  }
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  } catch {
    return isoString;
  }
}
