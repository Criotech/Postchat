import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { pickCollectionFile } from "./collectionParser";
import { parseEnvironment, pickEnvironmentFile } from "./environmentParser";
import {
  collectionToMarkdown,
  parseSpec,
  resolveVariables,
  type ParsedCollection,
  type SpecType
} from "./specParser";
import {
  ANTHROPIC_MODEL,
  MODEL_NAME,
  OPENAI_MODEL,
  buildSystemPrompt,
  getProvider
} from "./llmClient";
import { filterCollectionMarkdown } from "./collectionFilter";
import { findRequestByKeyword } from "./collectionLookup";
import { generateSuggestions } from "./promptSuggester";
import { executeRequest, type ExecutableRequest } from "./requestExecutor";
import { RequestTabProvider } from "./requestTabProvider";
import { scanForSecrets } from "./secretScanner";

type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

type LoadedSpecType = Exclude<SpecType, "unknown">;
const UNRECOGNIZED_SPEC_ERROR =
  "Unrecognized file format. Please select a Postman Collection (.json) or an OpenAPI/Swagger specification (.yaml, .yml, .json).";
const ENVIRONMENT_STATE_KEY = "postchat.environmentVariables";

type IncomingWebviewMessage =
  | { command: "loadCollection" }
  | { command: "loadEnvironment" }
  | { command: "openRequestTab"; endpointId: string }
  | { command: "getCollectionData" }
  | { command: "sendMessage"; text?: string }
  | { command: "runRequest"; requestName?: string }
  | { command: "executeRequest"; request: ExecutableRequest }
  | { command: "executeRequestByEndpoint"; method: string; url: string }
  | { command: "exportChat" }
  | { command: "confirmSend"; originalMessage?: string }
  | { command: "cancelSend" }
  | { command: "clearChat" }
  | { command: "updateConfig"; key: string; value: string };

export class PostchatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "postchatView";

  private view?: vscode.WebviewView;
  private conversationHistory: ConversationTurn[] = [];
  /** Redacted markdown (env vars as {{placeholders}}) — sent to the LLM */
  private collectionMarkdown: string | null = null;
  /** Resolved markdown (env vars substituted) — used for request execution only */
  private resolvedCollectionMarkdown: string | null = null;
  private collectionName: string | null = null;
  private collectionFilePath: string | null = null;
  private collectionSpecType: LoadedSpecType | null = null;
  private parsedCollection: ParsedCollection | null = null;
  private resolvedParsedCollection: ParsedCollection | null = null;
  private environmentVariables: Record<string, string> | null = null;
  private hasSecretSendApproval = false;
  private pendingConfirmedMessage: string | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly requestTabProvider: RequestTabProvider,
    private readonly context: vscode.ExtensionContext
  ) {
    this.environmentVariables =
      this.context.workspaceState.get<Record<string, string>>(ENVIRONMENT_STATE_KEY) ?? null;
  }

  public getResolvedParsedCollection(): ParsedCollection | null {
    return this.resolvedParsedCollection;
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    const distUri = vscode.Uri.joinPath(this.extensionUri, "webview-ui", "dist");
    const { webview } = webviewView;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [distUri]
    };

    const builtHtml = this.getBuiltWebviewHtml(webview, distUri);
    webview.html = builtHtml ?? this.getPlaceholderHtml();

    webview.onDidReceiveMessage(async (message: IncomingWebviewMessage) => {
      await this.handleWebviewMessage(message);
    });

    // Send provider info and config whenever the view becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.postProviderInfo();
        this.sendConfigToWebview();
      }
    });

    // React to configuration changes
    const configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("postchat.provider") ||
        e.affectsConfiguration("postchat.anthropicModel") ||
        e.affectsConfiguration("postchat.openaiModel") ||
        e.affectsConfiguration("postchat.ollamaModel")
      ) {
        this.postProviderInfo();
      }
    });

    webviewView.onDidDispose(() => configDisposable.dispose());
  }

  private postProviderInfo(): void {
    const { provider, model } = this.getProviderLabel();
    this.postToWebview({ command: "providerChanged", provider, model });
  }

  private getProviderLabel(): { provider: string; model: string } {
    const config = vscode.workspace.getConfiguration("postchat");
    const provider = config.get<string>("provider", "anthropic");

    if (provider === "openai") {
      const model = config.get<string>("openaiModel", OPENAI_MODEL).trim() || OPENAI_MODEL;
      return { provider: "openai", model };
    }

    if (provider === "ollama") {
      const model = config.get<string>("ollamaModel", "llama3").trim();
      return { provider: "ollama", model };
    }

    const model = config.get<string>("anthropicModel", ANTHROPIC_MODEL).trim() || ANTHROPIC_MODEL;
    return { provider: "anthropic", model };
  }

  private sendConfigToWebview(): void {
    const config = vscode.workspace.getConfiguration("postchat");
    this.postToWebview({
      command: "configLoaded",
      provider: config.get<string>("provider", "anthropic"),
      anthropicApiKey: config.get<string>("apiKey", ""),
      anthropicModel: config.get<string>("anthropicModel", ANTHROPIC_MODEL),
      openaiApiKey: config.get<string>("openaiApiKey", ""),
      openaiModel: config.get<string>("openaiModel", OPENAI_MODEL),
      ollamaEndpoint: config.get<string>("ollamaEndpoint", "http://localhost:11434"),
      ollamaModel: config.get<string>("ollamaModel", "llama3")
    });
  }

  private async handleUpdateConfig(key: string, value: string): Promise<void> {
    const allowed = [
      "provider",
      "apiKey",
      "anthropicModel",
      "openaiApiKey",
      "openaiModel",
      "ollamaEndpoint",
      "ollamaModel"
    ];
    if (!allowed.includes(key)) {
      return;
    }
    await vscode.workspace
      .getConfiguration("postchat")
      .update(key, value, vscode.ConfigurationTarget.Global);
  }

  private getActiveApiKey(): string | undefined {
    const config = vscode.workspace.getConfiguration("postchat");
    const provider = config.get<string>("provider", "anthropic");

    if (provider === "anthropic") {
      return config.get<string>("apiKey", "").trim() || undefined;
    }

    if (provider === "openai") {
      return config.get<string>("openaiApiKey", "").trim() || undefined;
    }

    // ollama: no key needed
    return undefined;
  }

  private async handleWebviewMessage(message: IncomingWebviewMessage): Promise<void> {
    if (!message || typeof message !== "object" || !("command" in message)) {
      return;
    }

    switch (message.command) {
      case "loadCollection":
        await this.handleLoadCollection();
        break;
      case "sendMessage":
        await this.handleSendMessage(message.text ?? "");
        break;
      case "confirmSend":
        await this.handleConfirmSend(message.originalMessage ?? "");
        break;
      case "cancelSend":
        this.handleCancelSend();
        break;
      case "runRequest":
        await this.handleRunRequest(message.requestName ?? "");
        break;
      case "executeRequest":
        await this.handleExecuteRequest(message.request);
        break;
      case "executeRequestByEndpoint":
        await this.handleExecuteByEndpoint(message.method, message.url);
        break;
      case "exportChat":
        await this.handleExportChat();
        break;
      case "loadEnvironment":
        await this.handleLoadEnvironment();
        break;
      case "openRequestTab":
        this.handleOpenRequestTab(message.endpointId);
        break;
      case "getCollectionData":
        this.postToWebview({
          command: "collectionData",
          collection: this.resolvedParsedCollection
            ? (JSON.parse(JSON.stringify(this.resolvedParsedCollection)) as ParsedCollection)
            : null
        });
        break;
      case "clearChat":
        this.conversationHistory = [];
        this.postToWebview({ command: "clearChat" });
        break;
      case "updateConfig":
        await this.handleUpdateConfig(message.key, message.value);
        break;
      default:
        break;
    }
  }

  private getSpecDisplayLabel(specType: LoadedSpecType): string {
    if (specType === "openapi3") {
      return "OpenAPI 3.0 specification";
    }
    if (specType === "swagger2") {
      return "Swagger 2.0 specification";
    }
    return "collection";
  }

  private async handleLoadCollection(): Promise<void> {
    try {
      const selectedPath = await pickCollectionFile();
      if (!selectedPath) {
        return;
      }
      this.postToWebview({ command: "showSuggestions", suggestions: [] });

      const parsed = await parseSpec(selectedPath);
      const resolved = this.environmentVariables
        ? resolveVariables(parsed, this.environmentVariables)
        : parsed;
      this.collectionFilePath = selectedPath;
      this.collectionName = parsed.title;
      this.collectionSpecType = parsed.specType;
      this.parsedCollection = parsed;
      this.resolvedParsedCollection = resolved;
      this.collectionMarkdown = collectionToMarkdown(parsed);
      this.resolvedCollectionMarkdown = collectionToMarkdown(resolved);
      this.conversationHistory = [];
      this.hasSecretSendApproval = false;
      this.pendingConfirmedMessage = null;

      this.postToWebview({
        command: "collectionLoaded",
        name: parsed.title,
        path: selectedPath,
        specType: parsed.specType,
        baseUrl: parsed.baseUrl,
        endpointCount: parsed.endpoints.length,
        authSchemes: parsed.authSchemes,
        rawSpec: parsed.rawSpec
      });
      this.postAssistantMessage(
        `Loaded ${this.getSpecDisplayLabel(this.collectionSpecType)} **${this.collectionName}**.`
      );

      if (parsed.endpoints.length === 0) {
        this.postAssistantMessage(
          "This specification has no paths/endpoints defined. You can still chat about top-level API metadata."
        );
      }

      // Suggestions always use the Anthropic key; falls back to static suggestions if unavailable
      const anthropicKey = vscode.workspace
        .getConfiguration("postchat")
        .get<string>("apiKey", "")
        .trim();

      const suggestions = await generateSuggestions({
        apiKey: anthropicKey,
        provider: MODEL_NAME,
        collectionMarkdown: this.collectionMarkdown
      });
      this.postToWebview({ command: "showSuggestions", suggestions });

      if (parsed.endpoints.length > 50) {
        this.postAssistantMessage(
          `Large specification detected (${parsed.endpoints.length} endpoints). Responses may be slower.`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Could not read file: ")) {
        this.postAssistantMessage(message);
        return;
      }
      if (
        message === "Invalid YAML syntax in spec file. Check the file is valid YAML." ||
        message === "Invalid JSON in collection file. Check the file is valid JSON." ||
        message === UNRECOGNIZED_SPEC_ERROR
      ) {
        this.postAssistantMessage(message);
        return;
      }
      this.postAssistantMessage(`Could not load collection: ${message}`);
    }
  }

  private async handleLoadEnvironment(): Promise<void> {
    try {
      const selectedPath = await pickEnvironmentFile();
      if (!selectedPath) {
        return;
      }

      const parsedEnvironment = parseEnvironment(selectedPath);
      this.environmentVariables = parsedEnvironment;
      void this.context.workspaceState.update(ENVIRONMENT_STATE_KEY, parsedEnvironment);
      const environmentName = path.basename(selectedPath);

      if (this.collectionFilePath) {
        const parsed = this.parsedCollection ?? (await parseSpec(this.collectionFilePath));
        const resolved = resolveVariables(parsed, this.environmentVariables);
        this.parsedCollection = parsed;
        this.resolvedParsedCollection = resolved;
        this.collectionMarkdown = collectionToMarkdown(parsed);
        this.resolvedCollectionMarkdown = collectionToMarkdown(resolved);
        this.postToWebview({
          command: "collectionData",
          collection: JSON.parse(JSON.stringify(resolved)) as ParsedCollection
        });
      }

      this.postToWebview({ command: "environmentLoaded", name: environmentName });
      this.postAssistantMessage(`Loaded environment **${environmentName}**.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Invalid Postman environment file:")) {
        this.postAssistantMessage(
          "Invalid environment file. Make sure you select a Postman Environment JSON export."
        );
        return;
      }
      this.postAssistantMessage(`Could not load environment: ${message}`);
    }
  }

  private handleOpenRequestTab(endpointIdRaw: string): void {
    const endpointId = endpointIdRaw.trim();
    if (!endpointId) {
      return;
    }

    const endpoint = this.resolvedParsedCollection?.endpoints.find((item) => item.id === endpointId);
    if (!endpoint) {
      this.postError(
        `Unable to open request tab. Endpoint "${endpointId}" was not found in the active collection.`
      );
      return;
    }

    this.requestTabProvider.openRequestTab(endpoint);
  }

  private async handleSendMessage(userMessageRaw: string): Promise<void> {
    const userMessage = userMessageRaw.trim();
    if (!userMessage) {
      return;
    }

    if (!this.collectionMarkdown) {
      this.postAssistantMessage(
        "Please load a Postman collection or OpenAPI/Swagger specification first, then ask your question."
      );
      return;
    }

    if (this.collectionFilePath && this.collectionSpecType) {
      try {
        const parsed = await parseSpec(this.collectionFilePath);
        const resolved = this.environmentVariables
          ? resolveVariables(parsed, this.environmentVariables)
          : parsed;

        this.parsedCollection = parsed;
        this.resolvedParsedCollection = resolved;
        this.collectionSpecType = parsed.specType;
        this.collectionMarkdown = collectionToMarkdown(parsed);
        this.resolvedCollectionMarkdown = collectionToMarkdown(resolved);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.postAssistantMessage(`Could not parse specification: ${message}`);
        return;
      }
    }

    if (!this.hasSecretSendApproval) {
      // Scan the resolved version since that contains real secrets
      const findings = scanForSecrets(this.resolvedCollectionMarkdown ?? this.collectionMarkdown!);
      if (findings.length > 0) {
        this.pendingConfirmedMessage = userMessage;
        this.postToWebview({ command: "secretsFound", findings });
        return;
      }
      this.hasSecretSendApproval = true;
    }

    await this.sendMessageToLlm(userMessage);
  }

  private async handleConfirmSend(originalMessageRaw: string): Promise<void> {
    const originalMessage = originalMessageRaw.trim();
    const messageToSend = originalMessage || this.pendingConfirmedMessage?.trim() || "";
    if (!messageToSend) {
      return;
    }

    this.hasSecretSendApproval = true;
    this.pendingConfirmedMessage = null;
    await this.sendMessageToLlm(messageToSend);
  }

  private handleCancelSend(): void {
    this.pendingConfirmedMessage = null;
  }

  private async handleRunRequest(requestNameRaw: string): Promise<void> {
    const requestName = requestNameRaw.trim();
    const prompt = requestName
      ? `Show me how to run the API request named "${requestName}". Include method, URL, required headers, request body, and a runnable curl example.`
      : "Show me how to run an API request from this loaded specification. Include method, URL, required headers, request body, and a runnable curl example.";

    await this.handleSendMessage(prompt);
  }

  private async handleExecuteByEndpoint(method: string, url: string): Promise<void> {
    const markdown = this.resolvedCollectionMarkdown ?? this.collectionMarkdown;
    if (!markdown) {
      this.postAssistantMessage(
        "No specification loaded. Please load a Postman collection or OpenAPI/Swagger file first."
      );
      return;
    }

    // Look up in the resolved markdown so env vars are substituted
    const candidates = findRequestByKeyword(markdown, url);
    const match = candidates.find(
      (r) => r.method.toUpperCase() === method.toUpperCase() && r.url.includes(url)
    );

    if (match) {
      // Found full request with headers/body from the collection
      await this.handleExecuteRequest(match);
    } else {
      // Fallback: execute with just method + URL (no headers/body)
      await this.handleExecuteRequest({
        name: `${method} ${url}`,
        method,
        url,
        headers: {}
      });
    }
  }

  private async handleExecuteRequest(request: ExecutableRequest): Promise<void> {
    this.postToWebview({ command: "requestStarted", requestName: request.name });

    try {
      const result = await executeRequest(request);
      this.postToWebview({ command: "requestComplete", result, requestName: request.name });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postToWebview({ command: "requestError", error: message, requestName: request.name });
    }
  }

  private async handleExportChat(): Promise<void> {
    try {
      if (this.conversationHistory.length === 0) {
        void vscode.window.showInformationMessage("No conversation to export yet.");
        return;
      }

      const defaultFileName = `postchat-conversation-${new Date().toISOString().slice(0, 10)}.md`;
      const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
      const saveUri = await vscode.window.showSaveDialog({
        saveLabel: "Export Chat",
        defaultUri: workspaceUri
          ? vscode.Uri.joinPath(workspaceUri, defaultFileName)
          : undefined,
        filters: {
          Markdown: ["md"]
        }
      });

      if (!saveUri) {
        return;
      }

      const markdown = this.buildConversationMarkdown();
      await vscode.workspace.fs.writeFile(saveUri, Buffer.from(markdown, "utf8"));
      void vscode.window.showInformationMessage(
        `Postchat conversation exported to ${path.basename(saveUri.fsPath)}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postAssistantMessage(`Failed to export conversation: ${message}`);
    }
  }

  private buildConversationMarkdown(): string {
    const lines: string[] = ["# Postchat Conversation", ""];

    for (const turn of this.conversationHistory) {
      const heading = turn.role === "user" ? "## User" : "## Assistant";
      lines.push(heading, "", turn.content, "");
    }

    return lines.join("\n");
  }

  private async sendMessageToLlm(userMessage: string): Promise<void> {
    if (!this.collectionMarkdown) {
      this.postAssistantMessage(
        "Please load a Postman collection or OpenAPI/Swagger specification first, then ask your question."
      );
      return;
    }

    const config = vscode.workspace.getConfiguration("postchat");
    const providerType = config.get<string>("provider", "anthropic");
    const activeApiKey = this.getActiveApiKey();

    if (providerType !== "ollama" && !activeApiKey) {
      const settingKey =
        providerType === "openai" ? "postchat.openaiApiKey" : "postchat.apiKey";

      this.postAssistantMessage(
        `No API key set. Go to Settings and set \`${settingKey}\`, then try again.`
      );

      const action = "Open Settings";
      const selection = await vscode.window.showWarningMessage(
        `Postchat requires an API key (${settingKey}).`,
        action
      );

      if (selection === action) {
        await vscode.commands.executeCommand("workbench.action.openSettings", settingKey);
      }
      return;
    }

    // Ollama: verify endpoint is reachable before attempting chat
    if (providerType === "ollama") {
      const endpoint = config.get<string>("ollamaEndpoint", "http://localhost:11434").trim();
      try {
        const probe = await fetch(`${endpoint}/api/tags`, { method: "GET" });
        if (!probe.ok) {
          this.postAssistantMessage(
            `Could not connect to Ollama at ${endpoint}. Make sure Ollama is running locally.`
          );
          return;
        }
      } catch {
        this.postAssistantMessage(
          `Could not connect to Ollama at ${endpoint}. Make sure Ollama is running locally.`
        );
        return;
      }
    }

    this.postToWebview({ command: "addMessage", role: "user", text: userMessage });
    this.postToWebview({ command: "userMessage", text: userMessage });
    this.postThinking(true);

    try {
      const provider = getProvider(config);
      const filteredMarkdown = filterCollectionMarkdown(this.collectionMarkdown, userMessage);
      const systemPrompt = buildSystemPrompt(filteredMarkdown);

      const assistantResponse = await provider.sendMessage({
        systemPrompt,
        history: this.conversationHistory,
        userMessage
      });

      this.conversationHistory.push(
        { role: "user", content: userMessage },
        { role: "assistant", content: assistantResponse }
      );

      this.postToWebview({
        command: "addMessage",
        role: "assistant",
        text: assistantResponse
      });
      this.postToWebview({ command: "assistantMessage", text: assistantResponse });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postError(`Request failed: ${message} Please retry.`);
    } finally {
      this.postThinking(false);
    }
  }

  private postAssistantMessage(text: string): void {
    this.postToWebview({ command: "addMessage", role: "assistant", text });
    this.postToWebview({ command: "assistantMessage", text });
  }

  private postThinking(value: boolean): void {
    this.postToWebview({ command: "showThinking", value });
    this.postToWebview({ command: "setThinking", value });
  }

  private postError(text: string): void {
    this.postToWebview({ command: "showError", text });
    this.postToWebview({ command: "error", message: text });
  }

  private postToWebview(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private getBuiltWebviewHtml(
    webview: vscode.Webview,
    distUri: vscode.Uri
  ): string | undefined {
    const indexPath = path.join(this.extensionUri.fsPath, "webview-ui", "dist", "index.html");

    if (!fs.existsSync(indexPath)) {
      return undefined;
    }

    const html = fs.readFileSync(indexPath, "utf8");

    return html
      .replace(/(src|href)="\/(.*?)"/g, (_match, attr, assetPath) => {
        const uri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, assetPath)).toString();
        return `${attr}="${uri}"`;
      })
      .replace(/(src|href)="\.\/(.*?)"/g, (_match, attr, assetPath) => {
        const uri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, assetPath)).toString();
        return `${attr}="${uri}"`;
      })
      .replace(/ crossorigin/g, "");
  }

  private getPlaceholderHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Postchat</title>
  </head>
  <body>
    <div id="root">Postchat webview placeholder. Build webview-ui to load React app.</div>
  </body>
</html>`;
  }
}
