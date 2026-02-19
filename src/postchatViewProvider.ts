import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { parseCollection, parseCollectionWithStats, pickCollectionFile } from "./collectionParser";
import { parseEnvironment, pickEnvironmentFile } from "./environmentParser";
import {
  ANTHROPIC_MODEL,
  MODEL_NAME,
  OPENAI_MODEL,
  buildSystemPrompt,
  getProvider
} from "./llmClient";
import { generateSuggestions } from "./promptSuggester";
import { scanForSecrets } from "./secretScanner";

type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

type IncomingWebviewMessage =
  | { command: "loadCollection" }
  | { command: "loadEnvironment" }
  | { command: "sendMessage"; text?: string }
  | { command: "runRequest"; requestName?: string }
  | { command: "exportChat" }
  | { command: "confirmSend"; originalMessage?: string }
  | { command: "cancelSend" }
  | { command: "clearChat" };

export class PostchatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "postchatView";

  private view?: vscode.WebviewView;
  private conversationHistory: ConversationTurn[] = [];
  private collectionMarkdown: string | null = null;
  private collectionName: string | null = null;
  private collectionFilePath: string | null = null;
  private environmentVariables: Record<string, string> | null = null;
  private hasSecretSendApproval = false;
  private pendingConfirmedMessage: string | null = null;

  constructor(private readonly extensionUri: vscode.Uri) {}

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

    // Send provider info whenever the view becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.postProviderInfo();
      }
    });

    // React to configuration changes
    const configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("postchat.provider") ||
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
      return { provider: "openai", model: OPENAI_MODEL };
    }

    if (provider === "ollama") {
      const model = config.get<string>("ollamaModel", "llama3").trim();
      return { provider: "ollama", model };
    }

    return { provider: "anthropic", model: ANTHROPIC_MODEL };
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
      case "exportChat":
        await this.handleExportChat();
        break;
      case "loadEnvironment":
        await this.handleLoadEnvironment();
        break;
      case "clearChat":
        this.conversationHistory = [];
        this.postToWebview({ command: "clearChat" });
        break;
      default:
        break;
    }
  }

  private async handleLoadCollection(): Promise<void> {
    try {
      const selectedPath = await pickCollectionFile();
      if (!selectedPath) {
        return;
      }
      this.postToWebview({ command: "showSuggestions", suggestions: [] });

      const parsed = parseCollectionWithStats(selectedPath, this.environmentVariables ?? undefined);
      this.collectionFilePath = selectedPath;
      this.collectionName = path.basename(selectedPath);

      if (parsed.requestCount === 0) {
        this.collectionMarkdown = null;
        this.postAssistantMessage(
          "This collection has no requests. Please load a Postman collection that contains at least one request."
        );
        return;
      }

      this.collectionMarkdown = parsed.markdown;
      this.conversationHistory = [];
      this.hasSecretSendApproval = false;
      this.pendingConfirmedMessage = null;

      this.postToWebview({ command: "collectionLoaded", name: this.collectionName });
      this.postAssistantMessage(`Loaded collection **${this.collectionName}**.`);

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

      if (parsed.requestCount > 50) {
        this.postAssistantMessage(
          `Large collection detected (${parsed.requestCount} requests). Responses may be slower.`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
      const environmentName = path.basename(selectedPath);

      if (this.collectionFilePath) {
        const parsedCollection = parseCollectionWithStats(
          this.collectionFilePath,
          this.environmentVariables
        );
        this.collectionMarkdown = parsedCollection.requestCount > 0 ? parsedCollection.markdown : null;
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

  private async handleSendMessage(userMessageRaw: string): Promise<void> {
    const userMessage = userMessageRaw.trim();
    if (!userMessage) {
      return;
    }

    if (!this.collectionMarkdown) {
      this.postAssistantMessage(
        "Please load a Postman collection first, then ask your question."
      );
      return;
    }

    if (this.collectionFilePath) {
      try {
        this.collectionMarkdown = parseCollection(
          this.collectionFilePath,
          this.environmentVariables ?? undefined
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.postAssistantMessage(`Could not parse collection: ${message}`);
        return;
      }
    }

    if (!this.hasSecretSendApproval) {
      const findings = scanForSecrets(this.collectionMarkdown);
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
      ? `Show me how to run the Postman request named "${requestName}". Include method, URL, required headers, request body, and a runnable curl example.`
      : "Show me how to run a Postman request from this collection. Include method, URL, required headers, request body, and a runnable curl example.";

    await this.handleSendMessage(prompt);
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
        "Please load a Postman collection first, then ask your question."
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
      const systemPrompt = buildSystemPrompt(this.collectionMarkdown);

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
      });
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
