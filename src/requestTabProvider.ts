import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { filterCollectionMarkdown } from "./collectionFilter";
import { buildSystemPrompt, type LlmProvider } from "./llmClient";
import { executeRequest, type ExecutableRequest } from "./requestExecutor";
import { collectionToMarkdown, type ParsedCollection, type ParsedEndpoint } from "./specParser";

type RequestTabMessage =
  | { command: "executeRequest"; request?: Partial<ExecutableRequest> }
  | {
      command: "askAI";
      text?: string;
      prompt?: string;
      question?: string;
      history?: Array<{ role?: string; content?: string }>;
    }
  | { command: "saveToCollection" }
  | { command: "copySnippet" }
  | { command: "tabReady" }
  | { command: "refreshEndpointData" };

export class RequestTabProvider {
  private openTabs: Map<string, vscode.WebviewPanel> = new Map();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getCollection: () => ParsedCollection | null,
    private readonly getEnvironmentVariables: () => Record<string, string>,
    private readonly llmClient: LlmProvider
  ) {}

  openRequestTab(endpoint: ParsedEndpoint): void {
    const existingPanel = this.openTabs.get(endpoint.id);
    if (existingPanel) {
      existingPanel.reveal(vscode.ViewColumn.One);
      void existingPanel.webview.postMessage({ command: "flashHighlight" });
      return;
    }

    const sidebarDistUri = vscode.Uri.joinPath(this.context.extensionUri, "webview-ui", "dist");

    const panel = vscode.window.createWebviewPanel(
      "postchat.requestTab",
      this.buildBaseTitle(endpoint),
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [sidebarDistUri]
      }
    );

    const svgDot = this.generateMethodSvg(endpoint.method);
    panel.iconPath = vscode.Uri.parse(`data:image/svg+xml,${encodeURIComponent(svgDot)}`);
    panel.webview.html = this.getRequestTabHtml(panel);
    let activeEndpoint = endpoint;

    panel.webview.onDidReceiveMessage(async (message: RequestTabMessage) => {
      if (!message || typeof message !== "object" || !("command" in message)) {
        return;
      }

      switch (message.command) {
        case "executeRequest":
          await this.handleExecuteRequest(panel, activeEndpoint, message.request);
          break;
        case "askAI":
          await this.handleAskAi(panel, activeEndpoint, message);
          break;
        case "saveToCollection":
          // Reserved for future collection mutation support.
          break;
        case "copySnippet":
          // Frontend-only behavior.
          break;
        case "tabReady":
          void panel.webview.postMessage({
            command: "loadEndpoint",
            endpoint: activeEndpoint,
            collection: this.getCollection(),
            environmentVariables: this.getEnvironment()
          });
          break;
        case "refreshEndpointData": {
          const refreshed = this.getCollection()?.endpoints.find((item) => item.id === activeEndpoint.id);
          if (!refreshed) {
            void panel.webview.postMessage({
              command: "endpointRefreshUnavailable",
              endpointId: activeEndpoint.id,
              error: "This endpoint no longer exists in the active collection."
            });
            break;
          }

          activeEndpoint = refreshed;
          panel.title = this.buildBaseTitle(activeEndpoint);
          panel.iconPath = vscode.Uri.parse(
            `data:image/svg+xml,${encodeURIComponent(this.generateMethodSvg(activeEndpoint.method))}`
          );
          void panel.webview.postMessage({
            command: "loadEndpoint",
            endpoint: activeEndpoint,
            collection: this.getCollection(),
            environmentVariables: this.getEnvironment()
          });
          break;
        }
        default:
          break;
      }
    });

    panel.onDidDispose(() => {
      this.openTabs.delete(endpoint.id);
    });

    this.openTabs.set(endpoint.id, panel);
  }

  closeAllTabs(): void {
    for (const panel of [...this.openTabs.values()]) {
      panel.dispose();
    }
    this.openTabs.clear();
  }

  closeTab(endpointId: string): void {
    this.openTabs.get(endpointId)?.dispose();
  }

  runCurrentTab(): boolean {
    const panel = this.getActiveTab();
    if (!panel) {
      return false;
    }

    void panel.webview.postMessage({ command: "triggerRunRequest" });
    return true;
  }

  notifyCollectionReloaded(): void {
    for (const panel of this.openTabs.values()) {
      void panel.webview.postMessage({ command: "collectionReloaded" });
    }
  }

  private getActiveTab(): vscode.WebviewPanel | undefined {
    for (const panel of this.openTabs.values()) {
      if (panel.active) {
        return panel;
      }
    }

    for (const panel of this.openTabs.values()) {
      if (panel.visible) {
        return panel;
      }
    }

    return undefined;
  }

  private async handleExecuteRequest(
    panel: vscode.WebviewPanel,
    endpoint: ParsedEndpoint,
    requestInput?: Partial<ExecutableRequest>
  ): Promise<void> {
    const request = this.toExecutableRequest(endpoint, requestInput);
    panel.title = this.buildBaseTitle(endpoint);
    await panel.webview.postMessage({
      command: "requestStarted",
      requestName: request.name,
      endpointId: endpoint.id
    });

    try {
      const result = await executeRequest(request);
      await panel.webview.postMessage({
        command: "requestComplete",
        result,
        requestName: request.name,
        endpointId: endpoint.id
      });
      panel.title = this.buildTitleWithStatus(endpoint, result.status);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await panel.webview.postMessage({
        command: "requestError",
        error: message,
        requestName: request.name,
        endpointId: endpoint.id
      });
    }
  }

  private async handleAskAi(
    panel: vscode.WebviewPanel,
    endpoint: ParsedEndpoint,
    message: Extract<RequestTabMessage, { command: "askAI" }>
  ): Promise<void> {
    const userPrompt = (message.text ?? message.prompt ?? message.question ?? "").trim();
    if (!userPrompt) {
      await panel.webview.postMessage({
        command: "askAIError",
        error: "Prompt cannot be empty.",
        endpointId: endpoint.id
      });
      return;
    }

    const collection = this.getCollection();
    const collectionMarkdown = collection ? collectionToMarkdown(collection) : "No collection loaded.";
    const filteredCollection = filterCollectionMarkdown(collectionMarkdown, userPrompt);
    const endpointContext = this.buildEndpointContext(endpoint);
    const systemPrompt = buildSystemPrompt(
      `${filteredCollection}\n\n--- ACTIVE ENDPOINT ---\n${endpointContext}`
    );
    const history = this.normalizeHistory(message.history);

    await panel.webview.postMessage({ command: "showThinking", value: true });

    try {
      const response = await this.llmClient.sendMessage({
        systemPrompt,
        history,
        userMessage: userPrompt
      });

      await panel.webview.postMessage({
        command: "askAIResponse",
        text: response,
        endpointId: endpoint.id
      });
      await panel.webview.postMessage({
        command: "aiResponse",
        text: response,
        endpointId: endpoint.id
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await panel.webview.postMessage({
        command: "askAIError",
        error: errorMessage,
        endpointId: endpoint.id
      });
    } finally {
      await panel.webview.postMessage({ command: "showThinking", value: false });
    }
  }

  private getRequestTabHtml(panel: vscode.WebviewPanel): string {
    const indexPathCandidates = [
      path.join(this.context.extensionUri.fsPath, "webview-ui", "dist", "request-tab.html"),
      path.join(this.context.extensionUri.fsPath, "webview-ui", "requestTab", "dist", "index.html"),
      path.join(this.context.extensionUri.fsPath, "webview-ui", "dist", "requestTab", "index.html")
    ];

    const indexPath = indexPathCandidates.find((candidate) => fs.existsSync(candidate));
    if (!indexPath) {
      return this.getPlaceholderHtml();
    }

    const distUri = vscode.Uri.file(path.dirname(indexPath));
    const html = fs.readFileSync(indexPath, "utf8");

    return html
      .replace(/(src|href)="\/(.*?)"/g, (_match, attr, assetPath) => {
        const uri = panel.webview
          .asWebviewUri(vscode.Uri.joinPath(distUri, assetPath))
          .toString();
        return `${attr}="${uri}"`;
      })
      .replace(/(src|href)="\.\/(.*?)"/g, (_match, attr, assetPath) => {
        const uri = panel.webview
          .asWebviewUri(vscode.Uri.joinPath(distUri, assetPath))
          .toString();
        return `${attr}="${uri}"`;
      })
      .replace(/ crossorigin/g, "");
  }

  private generateMethodSvg(method: string): string {
    const colorByMethod: Record<string, string> = {
      GET: "#3B82F6",
      POST: "#22C55E",
      PUT: "#F97316",
      PATCH: "#EAB308",
      DELETE: "#EF4444"
    };

    const color = colorByMethod[method.toUpperCase()] ?? "#6B7280";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${color}"/></svg>`;
  }

  private buildBaseTitle(endpoint: ParsedEndpoint): string {
    return `${endpoint.method} ${endpoint.name}`;
  }

  private buildTitleWithStatus(endpoint: ParsedEndpoint, status: number): string {
    return `${this.buildBaseTitle(endpoint)} · ${status}`;
  }

  private toExecutableRequest(
    endpoint: ParsedEndpoint,
    requestInput?: Partial<ExecutableRequest>
  ): ExecutableRequest {
    const request = requestInput ?? {};
    const fallbackHeaders = endpoint.headers.reduce<Record<string, string>>((acc, header) => {
      if (header.enabled && header.key.trim()) {
        acc[header.key] = header.value;
      }
      return acc;
    }, {});

    return {
      name: typeof request.name === "string" && request.name.trim() ? request.name : endpoint.id,
      method:
        typeof request.method === "string" && request.method.trim()
          ? request.method
          : endpoint.method,
      url: typeof request.url === "string" && request.url.trim() ? request.url : endpoint.url,
      headers: this.isStringRecord(request.headers) ? request.headers : fallbackHeaders,
      body:
        typeof request.body === "string"
          ? request.body
          : endpoint.requestBody?.trim()
            ? endpoint.requestBody
            : undefined
    };
  }

  private isStringRecord(value: unknown): value is Record<string, string> {
    if (!value || typeof value !== "object") {
      return false;
    }
    return Object.values(value).every((entry) => typeof entry === "string");
  }

  private normalizeHistory(
    historyInput?: Array<{ role?: string; content?: string }>
  ): Array<{ role: "user" | "assistant"; content: string }> {
    if (!Array.isArray(historyInput)) {
      return [];
    }

    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const turn of historyInput) {
      if (!turn || typeof turn !== "object") {
        continue;
      }
      const role = turn.role === "assistant" ? "assistant" : turn.role === "user" ? "user" : null;
      const content = typeof turn.content === "string" ? turn.content.trim() : "";
      if (!role || !content) {
        continue;
      }
      history.push({ role, content });
    }
    return history;
  }

  private buildEndpointContext(endpoint: ParsedEndpoint): string {
    const parameters =
      endpoint.parameters.length > 0
        ? endpoint.parameters
            .map(
              (param) =>
                `${param.location}.${param.name} (${param.required ? "required" : "optional"}, ${param.type})`
            )
            .join(", ")
        : "None";
    const headers =
      endpoint.headers.length > 0
        ? endpoint.headers
            .filter((header) => header.enabled)
            .map((header) => `${header.key}: ${header.value}`)
            .join(", ") || "None"
        : "None";

    return [
      `ID: ${endpoint.id}`,
      `Name: ${endpoint.name}`,
      `Method: ${endpoint.method}`,
      `URL: ${endpoint.url}`,
      `Path: ${endpoint.path}`,
      `Description: ${endpoint.description ?? "None"}`,
      `Parameters: ${parameters}`,
      `Headers: ${headers}`,
      `Request Body: ${endpoint.requestBody ?? "None"}`
    ].join("\n");
  }

  private getEnvironment(): Record<string, string> {
    return this.getEnvironmentVariables();
  }

  private getPlaceholderHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Postchat Request Tab</title>
  </head>
  <body>
    <div id="root">Postchat request tab placeholder. Build request tab UI to load this view.</div>
  </body>
</html>`;
  }
}
