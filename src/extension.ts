import * as vscode from "vscode";
import { getProvider } from "./llmClient";
import { PostchatViewProvider } from "./postchatViewProvider";
import { RequestTabProvider } from "./requestTabProvider";
import type { ParsedEndpoint } from "./specParser";
import { formatQuerySummary } from "./contextFilter/queryAnalyzer";

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

  context.subscriptions.push(
    startCommand,
    openRequestTabCommand,
    runCurrentTabCommand,
    closeAllRequestTabsCommand,
    debugContextCommand,
    { dispose: () => requestTabProvider.closeAllTabs() }
  );
}

export function deactivate(): void {
  // Placeholder for cleanup logic.
}
