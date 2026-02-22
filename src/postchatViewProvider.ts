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
// import { scanForSecrets } from "./secretScanner";

type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

type LoadedSpecType = Exclude<SpecType, "unknown">;

type LoadedCollectionState = {
  name: string;
  markdown: string;
  specType: LoadedSpecType;
  environment?: Record<string, string>;
  envName?: string;
  parsedCollection: ParsedCollection;
  resolvedParsedCollection: ParsedCollection;
  resolvedMarkdown: string;
};

type CollectionSummary = {
  id: string;
  path: string;
  name: string;
  specType: LoadedSpecType;
  envName?: string;
};

const UNRECOGNIZED_SPEC_ERROR =
  "Unrecognized file format. Please select a Postman Collection (.json) or an OpenAPI/Swagger specification (.yaml, .yml, .json).";
const MAX_LOADED_COLLECTIONS = 5;

type IncomingWebviewMessage =
  | { command: "loadCollection" }
  | { command: "switchCollection"; id: string }
  | { command: "removeCollection"; id: string }
  | { command: "loadEnvironment" }
  | { command: "openRequestTab"; endpointId: string }
  | { command: "setSelectedEndpoint"; endpointId: string | null }
  | { command: "getCollectionData" }
  | { command: "sendMessage"; text?: string }
  | { command: "runRequest"; requestName?: string }
  | { command: "executeRequest"; request: ExecutableRequest }
  | { command: "executeRequestByEndpoint"; method: string; url: string }
  | { command: "exportChat" }
  // | { command: "confirmSend"; originalMessage?: string }
  // | { command: "cancelSend" }
  | { command: "clearChat" }
  | { command: "updateConfig"; key: string; value: string };

export class PostchatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "postchatView";

  private view?: vscode.WebviewView;
  private conversationHistory: ConversationTurn[] = [];
  private collections: Map<string, LoadedCollectionState> = new Map();
  private activeCollectionId: string | null = null;
  private selectedExplorerEndpointId: string | null = null;
  // private hasSecretSendApproval = false;
  // private pendingConfirmedMessage: string | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly requestTabProvider: RequestTabProvider
  ) {}

  public getResolvedParsedCollection(): ParsedCollection | null {
    return this.getActiveCollection()?.resolvedParsedCollection ?? null;
  }

  public getActiveEnvironment(): Record<string, string> {
    return this.getActiveCollection()?.environment ?? {};
  }

  public openSelectedRequestTab(): boolean {
    const selectedId = this.selectedExplorerEndpointId?.trim() ?? "";
    if (!selectedId) {
      return false;
    }

    const endpoint = this.getActiveCollection()?.resolvedParsedCollection.endpoints.find(
      (item) => item.id === selectedId
    );
    if (!endpoint) {
      return false;
    }

    this.requestTabProvider.openRequestTab(endpoint);
    return true;
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

  private getActiveCollection(): LoadedCollectionState | null {
    if (!this.activeCollectionId) {
      return null;
    }
    return this.collections.get(this.activeCollectionId) ?? null;
  }

  private getCollectionsSummary(): CollectionSummary[] {
    return Array.from(this.collections.entries()).map(([id, collection]) => ({
      id,
      path: id,
      name: collection.name,
      specType: collection.specType,
      envName: collection.envName
    }));
  }

  private cloneParsedCollection(collection: ParsedCollection): ParsedCollection {
    return JSON.parse(JSON.stringify(collection)) as ParsedCollection;
  }

  private createCollectionState(
    parsed: ParsedCollection,
    environment?: Record<string, string>,
    envName?: string
  ): LoadedCollectionState {
    const resolved = environment ? resolveVariables(parsed, environment) : parsed;

    return {
      name: parsed.title,
      markdown: collectionToMarkdown(parsed),
      specType: parsed.specType as LoadedSpecType,
      environment,
      envName,
      parsedCollection: parsed,
      resolvedParsedCollection: resolved,
      resolvedMarkdown: collectionToMarkdown(resolved)
    };
  }

  private async refreshCollectionFromDisk(collectionId: string): Promise<LoadedCollectionState | null> {
    const existing = this.collections.get(collectionId);
    if (!existing) {
      return null;
    }

    const parsed = await parseSpec(collectionId);
    const next = this.createCollectionState(parsed, existing.environment, existing.envName);
    this.collections.set(collectionId, next);

    return next;
  }

  private ensureSelectedEndpointIsValid(): void {
    const active = this.getActiveCollection();
    if (!active || !this.selectedExplorerEndpointId) {
      return;
    }

    if (
      !active.resolvedParsedCollection.endpoints.some(
        (endpoint) => endpoint.id === this.selectedExplorerEndpointId
      )
    ) {
      this.selectedExplorerEndpointId = null;
    }
  }

  private postActiveCollectionData(): void {
    const active = this.getActiveCollection();

    this.postToWebview({
      command: "collectionData",
      activeCollectionId: this.activeCollectionId,
      collections: this.getCollectionsSummary(),
      collection: active ? this.cloneParsedCollection(active.resolvedParsedCollection) : null
    });
  }

  private postCollectionChanged(
    command: "collectionLoaded" | "collectionSwitched",
    collectionId: string,
    collection: LoadedCollectionState
  ): void {
    this.postToWebview({
      command,
      id: collectionId,
      path: collectionId,
      name: collection.name,
      specType: collection.specType,
      envName: collection.envName,
      baseUrl: collection.resolvedParsedCollection.baseUrl,
      endpointCount: collection.resolvedParsedCollection.endpoints.length,
      authSchemes: collection.resolvedParsedCollection.authSchemes,
      rawSpec: collection.resolvedParsedCollection.rawSpec,
      activeCollectionId: this.activeCollectionId,
      collections: this.getCollectionsSummary()
    });
  }

  private async refreshSuggestionsForActiveCollection(): Promise<void> {
    const active = this.getActiveCollection();
    if (!active) {
      this.postToWebview({ command: "showSuggestions", suggestions: [] });
      return;
    }

    try {
      const anthropicKey = vscode.workspace
        .getConfiguration("postchat")
        .get<string>("apiKey", "")
        .trim();

      const suggestions = await generateSuggestions({
        apiKey: anthropicKey,
        provider: MODEL_NAME,
        collectionMarkdown: active.markdown
      });

      this.postToWebview({ command: "showSuggestions", suggestions });
    } catch {
      this.postToWebview({ command: "showSuggestions", suggestions: [] });
    }
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
      case "switchCollection":
        await this.handleSwitchCollection(message.id);
        break;
      case "removeCollection":
        await this.handleRemoveCollection(message.id);
        break;
      case "sendMessage":
        await this.handleSendMessage(message.text ?? "");
        break;
      // case "confirmSend":
      //   await this.handleConfirmSend(message.originalMessage ?? "");
      //   break;
      // case "cancelSend":
      //   this.handleCancelSend();
      //   break;
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
      case "setSelectedEndpoint":
        this.selectedExplorerEndpointId =
          typeof message.endpointId === "string" && message.endpointId.trim()
            ? message.endpointId.trim()
            : null;
        break;
      case "getCollectionData":
        this.postActiveCollectionData();
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

      const alreadyLoaded = this.collections.has(selectedPath);
      if (!alreadyLoaded && this.collections.size >= MAX_LOADED_COLLECTIONS) {
        void vscode.window.showErrorMessage(
          `You can load up to ${MAX_LOADED_COLLECTIONS} collections at once. Remove one before loading another.`
        );
        return;
      }

      this.postToWebview({ command: "showSuggestions", suggestions: [] });

      const existing = this.collections.get(selectedPath);
      const parsed = await parseSpec(selectedPath);
      const next = this.createCollectionState(parsed, existing?.environment, existing?.envName);

      this.collections.set(selectedPath, next);
      this.activeCollectionId = selectedPath;
      // this.hasSecretSendApproval = false;
      // this.pendingConfirmedMessage = null;

      this.ensureSelectedEndpointIsValid();

      this.postCollectionChanged("collectionLoaded", selectedPath, next);
      this.postActiveCollectionData();

      this.requestTabProvider.notifyCollectionReloaded();
      this.postAssistantMessage(
        `Loaded ${this.getSpecDisplayLabel(next.specType)} **${next.name}**.`
      );

      if (next.resolvedParsedCollection.endpoints.length === 0) {
        this.postAssistantMessage(
          "This specification has no paths/endpoints defined. You can still chat about top-level API metadata."
        );
      }

      await this.refreshSuggestionsForActiveCollection();

      if (next.resolvedParsedCollection.endpoints.length > 50) {
        this.postAssistantMessage(
          `Large specification detected (${next.resolvedParsedCollection.endpoints.length} endpoints). Responses may be slower.`
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

  private async handleSwitchCollection(collectionIdRaw: string): Promise<void> {
    const collectionId = collectionIdRaw.trim();
    if (!collectionId) {
      return;
    }

    const collection = this.collections.get(collectionId);
    if (!collection) {
      this.postError(`Collection not found: ${collectionId}`);
      return;
    }

    this.activeCollectionId = collectionId;
    // this.hasSecretSendApproval = false;
    // this.pendingConfirmedMessage = null;
    this.ensureSelectedEndpointIsValid();

    this.postToWebview({ command: "showSuggestions", suggestions: [] });
    this.postCollectionChanged("collectionSwitched", collectionId, collection);
    this.postActiveCollectionData();
    this.requestTabProvider.notifyCollectionReloaded();

    await this.refreshSuggestionsForActiveCollection();
  }

  private async handleRemoveCollection(collectionIdRaw: string): Promise<void> {
    const collectionId = collectionIdRaw.trim();
    if (!collectionId || !this.collections.has(collectionId)) {
      return;
    }

    const wasActive = this.activeCollectionId === collectionId;
    this.collections.delete(collectionId);

    if (wasActive) {
      const nextActive = this.collections.keys().next();
      this.activeCollectionId = nextActive.done ? null : nextActive.value;
      // this.hasSecretSendApproval = false;
      // this.pendingConfirmedMessage = null;
      this.ensureSelectedEndpointIsValid();
    }

    this.postToWebview({
      command: "collectionRemoved",
      id: collectionId,
      activeCollectionId: this.activeCollectionId,
      collections: this.getCollectionsSummary()
    });

    this.postActiveCollectionData();

    if (wasActive) {
      const active = this.getActiveCollection();
      if (this.activeCollectionId && active) {
        this.postCollectionChanged("collectionSwitched", this.activeCollectionId, active);
      }
      this.requestTabProvider.notifyCollectionReloaded();
    }

    if (this.activeCollectionId) {
      this.postToWebview({ command: "showSuggestions", suggestions: [] });
      await this.refreshSuggestionsForActiveCollection();
    } else {
      this.selectedExplorerEndpointId = null;
      this.postToWebview({ command: "showSuggestions", suggestions: [] });
    }
  }

  private async handleLoadEnvironment(): Promise<void> {
    const activeCollectionId = this.activeCollectionId;
    const activeCollection = this.getActiveCollection();
    if (!activeCollectionId || !activeCollection) {
      this.postAssistantMessage(
        "Load a Postman collection or OpenAPI/Swagger specification first, then load an environment."
      );
      return;
    }

    try {
      const selectedPath = await pickEnvironmentFile();
      if (!selectedPath) {
        return;
      }

      const parsedEnvironment = parseEnvironment(selectedPath);
      const environmentName = path.basename(selectedPath);
      const updated = this.createCollectionState(
        activeCollection.parsedCollection,
        parsedEnvironment,
        environmentName
      );

      this.collections.set(activeCollectionId, updated);
      this.ensureSelectedEndpointIsValid();
      this.postActiveCollectionData();
      this.postToWebview({
        command: "environmentLoaded",
        id: activeCollectionId,
        name: environmentName,
        collections: this.getCollectionsSummary(),
        activeCollectionId: this.activeCollectionId
      });
      this.requestTabProvider.notifyCollectionReloaded();
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
    this.selectedExplorerEndpointId = endpointId;

    const endpoint = this.getActiveCollection()?.resolvedParsedCollection.endpoints.find(
      (item) => item.id === endpointId
    );
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

    const activeCollectionId = this.activeCollectionId;
    if (!activeCollectionId) {
      this.postAssistantMessage(
        "Please load a Postman collection or OpenAPI/Swagger specification first, then ask your question."
      );
      return;
    }

    const active = this.getActiveCollection();
    if (!active) {
      this.postAssistantMessage(
        "Please load a Postman collection or OpenAPI/Swagger specification first, then ask your question."
      );
      return;
    }

    // if (!this.hasSecretSendApproval) {
    //   const findings = scanForSecrets(active.resolvedMarkdown);
    //   if (findings.length > 0) {
    //     this.pendingConfirmedMessage = userMessage;
    //     this.postToWebview({ command: "secretsFound", findings });
    //     return;
    //   }
    //   this.hasSecretSendApproval = true;
    // }

    await this.sendMessageToLlm(userMessage);
  }

  // private async handleConfirmSend(originalMessageRaw: string): Promise<void> {
  //   const originalMessage = originalMessageRaw.trim();
  //   const messageToSend = originalMessage || this.pendingConfirmedMessage?.trim() || "";
  //   if (!messageToSend) {
  //     return;
  //   }
  //
  //   this.hasSecretSendApproval = true;
  //   this.pendingConfirmedMessage = null;
  //   await this.sendMessageToLlm(messageToSend);
  // }

  // private handleCancelSend(): void {
  //   this.pendingConfirmedMessage = null;
  // }

  private async handleRunRequest(requestNameRaw: string): Promise<void> {
    const requestName = requestNameRaw.trim();
    const prompt = requestName
      ? `How do I call the "${requestName}" endpoint?`
      : "How do I call an endpoint from this API?";

    await this.handleSendMessage(prompt);
  }

  private async handleExecuteByEndpoint(method: string, url: string): Promise<void> {
    const active = this.getActiveCollection();
    const markdown = active?.resolvedMarkdown ?? active?.markdown ?? null;
    if (!markdown) {
      this.postAssistantMessage(
        "No specification loaded. Please load a Postman collection or OpenAPI/Swagger file first."
      );
      return;
    }

    const candidates = findRequestByKeyword(markdown, url);
    const match = candidates.find(
      (r) => r.method.toUpperCase() === method.toUpperCase() && r.url.includes(url)
    );

    if (match) {
      await this.handleExecuteRequest(match);
    } else {
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
    const active = this.getActiveCollection();
    if (!active) {
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
      const filteredMarkdown = filterCollectionMarkdown(active.markdown, userMessage);
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
