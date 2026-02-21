import * as vscode from "vscode";
import { getProvider } from "./llmClient";
import { PostchatViewProvider } from "./postchatViewProvider";
import { RequestTabProvider } from "./requestTabProvider";
import type { ParsedEndpoint } from "./specParser";

function isParsedEndpoint(value: unknown): value is ParsedEndpoint {
  if (!value || typeof value !== "object") {
    return false;
  }

  const endpoint = value as Partial<ParsedEndpoint>;
  return (
    typeof endpoint.id === "string" &&
    typeof endpoint.name === "string" &&
    typeof endpoint.method === "string" &&
    typeof endpoint.url === "string" &&
    typeof endpoint.path === "string"
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const llmClient = getProvider(vscode.workspace.getConfiguration("postchat"));
  let viewProvider: PostchatViewProvider | undefined;
  const requestTabProvider = new RequestTabProvider(
    context,
    () => viewProvider?.getResolvedParsedCollection() ?? null,
    llmClient
  );
  viewProvider = new PostchatViewProvider(context.extensionUri, requestTabProvider, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PostchatViewProvider.viewType, viewProvider)
  );

  const startCommand = vscode.commands.registerCommand("postchat.start", () => {
    vscode.window.showInformationMessage("Postchat started.");
  });

  const openRequestTabCommand = vscode.commands.registerCommand(
    "postchat.openRequestTab",
    (endpoint: unknown) => {
      if (isParsedEndpoint(endpoint)) {
        requestTabProvider.openRequestTab(endpoint);
        return;
      }

      if (viewProvider?.openSelectedRequestTab()) {
        return;
      }

      void vscode.window.showInformationMessage("Select an endpoint in the Postchat explorer first.");
    }
  );

  const runCurrentTabCommand = vscode.commands.registerCommand("postchat.runCurrentTab", () => {
    if (requestTabProvider.runCurrentTab()) {
      return;
    }
    void vscode.window.showInformationMessage("No active Postchat request tab to run.");
  });

  const closeAllRequestTabsCommand = vscode.commands.registerCommand(
    "postchat.closeAllRequestTabs",
    () => {
      requestTabProvider.closeAllTabs();
    }
  );

  context.subscriptions.push(
    startCommand,
    openRequestTabCommand,
    runCurrentTabCommand,
    closeAllRequestTabsCommand,
    { dispose: () => requestTabProvider.closeAllTabs() }
  );
}

export function deactivate(): void {
  // Placeholder for cleanup logic.
}
