import * as vscode from "vscode";
import { getProvider } from "./llmClient";
import { PostchatViewProvider } from "./postchatViewProvider";
import { RequestTabProvider } from "./requestTabProvider";
import type { ParsedEndpoint } from "./specParser";
import { formatQuerySummary } from "./contextFilter/queryAnalyzer";
import { SourceRegistry } from "./integration";
import { setupPostmanCloud } from "./integration/sources/postmanCloudSetup";
import { setupUrlSource } from "./integration/sources/urlSource";
import { autoDetectAndRegister } from "./integration/sources/workspaceSource";

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
    () => viewProvider?.getActiveEnvironment() ?? {},
    llmClient
  );
  viewProvider = new PostchatViewProvider(context.extensionUri, requestTabProvider);

  // ─── SOURCE REGISTRY ─────────────────────────────────────
  const registry = new SourceRegistry(context);

  // TODO (INT-04): Instantiate and register WatchedFileSource
  // TODO (INT-05): Instantiate and register GitTrackedSource

  registry.onCollectionChange((collection) => {
    viewProvider?.setCollection(collection);
  });

  void registry.restoreLastSession().then((restored) => {
    if (!restored) {
      void autoDetectAndRegister(registry);
    }
  });

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

  const debugContextCommand = vscode.commands.registerCommand(
    "postchat.debugContext",
    async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Enter a test query",
        placeHolder: "e.g. how do I create a user"
      });

      if (!input) {
        return;
      }

      const smartContext = viewProvider?.getSmartContext();
      if (!smartContext) {
        void vscode.window.showWarningMessage("Postchat: No view provider available.");
        return;
      }

      let debugResult;
      try {
        debugResult = smartContext.debugQuery(input);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showWarningMessage(`Postchat: ${msg}`);
        return;
      }

      const { analysis, topResults } = debugResult;
      const channel = vscode.window.createOutputChannel("Postchat Context Debug");
      channel.clear();

      channel.appendLine("=== Query Analysis ===");
      channel.appendLine(`Original:    "${analysis.original}"`);
      channel.appendLine(`Normalized:  "${analysis.normalized}"`);
      channel.appendLine(`Intent:      ${analysis.intent}`);
      channel.appendLine(`Method hint: ${analysis.methodHint}`);
      channel.appendLine(`Keywords:    [${analysis.keywords.join(", ")}]`);
      channel.appendLine(`Entities:    [${analysis.entityTerms.join(", ")}]`);
      if (analysis.statusCodeHint !== null) {
        channel.appendLine(`Status code: ${analysis.statusCodeHint}`);
      }
      if (analysis.endpointHint !== null) {
        channel.appendLine(`Endpoint:    ${analysis.endpointHint}`);
      }
      channel.appendLine(`Global:      ${analysis.isGlobalQuery}`);
      channel.appendLine(`Single:      ${analysis.isSingleEndpointQuery}`);
      channel.appendLine(`Summary:     ${formatQuerySummary(analysis)}`);
      channel.appendLine("");

      channel.appendLine(`=== Top ${topResults.length} BM25 Results ===`);
      topResults.forEach((result, i) => {
        channel.appendLine(
          `#${i + 1}  Score: ${result.score.toFixed(2)}  ` +
          `${result.endpoint.method} ${result.endpoint.path}  ` +
          `"${result.endpoint.name}"`
        );
        channel.appendLine(
          `    Matched terms: [${result.matchedTerms.join(", ")}]`
        );
      });

      if (topResults.length === 0) {
        channel.appendLine("(no results)");
      }

      channel.appendLine("");
      channel.appendLine("=== Context Built ===");

      try {
        const contextResult = smartContext.getContextForQuery(input, []);
        const stats = contextResult.stats;
        channel.appendLine(`Budget mode: ${stats.budgetMode}`);
        channel.appendLine(`Full detail: ${stats.sentFull} endpoint(s) (~${stats.sentFull * 400} tokens)`);
        channel.appendLine(`Summary:     ${stats.sentSummary} endpoint(s) (~${stats.sentSummary * 60} tokens)`);
        channel.appendLine(`Excluded:    ${stats.excluded} endpoint(s)`);
        channel.appendLine(`Total est:   ~${stats.estimatedInputTokens} tokens`);
        channel.appendLine(`Saved:       ~${stats.estimatedCostSavingPercent}% vs full collection`);
        channel.appendLine(`Time:        ${stats.processingTimeMs}ms`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        channel.appendLine(`(could not build context: ${msg})`);
      }

      channel.show(true);
    }
  );

  const manageSourcesCommand = vscode.commands.registerCommand(
    "postchat.manageSources",
    async () => {
      const sources = registry.getAllSources();
      if (sources.length === 0) {
        void vscode.window.showInformationMessage(
          "Postchat: No collection sources registered."
        );
        return;
      }

      const items = sources.map((source) => ({
        label: source.label,
        description: `${source.type} · ${source.status}`,
        detail: source.description,
        sourceId: source.id
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a collection source to activate"
      });

      if (selected) {
        const result = await registry.activate(selected.sourceId);
        if (!result.success) {
          void vscode.window.showErrorMessage(
            `Postchat: Failed to activate source: ${result.error ?? "Unknown error"}`
          );
        }
      }
    }
  );

  const detectCollectionsCommand = vscode.commands.registerCommand(
    "postchat.detectCollections",
    async () => {
      const loaded = await autoDetectAndRegister(registry);
      if (!loaded) {
        void vscode.window.showInformationMessage(
          "Postchat: No API collections or specs found in this workspace."
        );
      }
    }
  );

  const connectPostmanCommand = vscode.commands.registerCommand(
    "postchat.connectPostman",
    async () => {
      const source = await setupPostmanCloud(context);
      if (!source) {
        return;
      }

      registry.register(source);
      const result = await registry.activate(source.getSourceInfo().id);
      if (result.success) {
        void vscode.window.showInformationMessage(
          `Postchat: Connected to "${source.getSourceInfo().label}" from Postman Cloud.`
        );
      } else {
        void vscode.window.showErrorMessage(
          `Postchat: Failed to fetch collection: ${result.error ?? "Unknown error"}`
        );
      }
    }
  );

  const importFromUrlCommand = vscode.commands.registerCommand(
    "postchat.importFromUrl",
    async () => {
      const source = await setupUrlSource();
      if (!source) {
        return;
      }

      registry.register(source);
      const result = await registry.activate(source.getSourceInfo().id);
      if (result.success) {
        void vscode.window.showInformationMessage(
          `Postchat: Loaded collection from ${source.getSourceInfo().label}.`
        );
      } else {
        void vscode.window.showErrorMessage(
          `Postchat: Failed to load URL: ${result.error ?? "Unknown error"}`
        );
      }
    }
  );

  context.subscriptions.push(
    startCommand,
    openRequestTabCommand,
    runCurrentTabCommand,
    closeAllRequestTabsCommand,
    debugContextCommand,
    manageSourcesCommand,
    detectCollectionsCommand,
    connectPostmanCommand,
    importFromUrlCommand,
    registry,
    { dispose: () => requestTabProvider.closeAllTabs() }
  );
}

export function deactivate(): void {
  // Placeholder for cleanup logic.
}
