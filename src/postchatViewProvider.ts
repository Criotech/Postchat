import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { parseCollectionWithStats, pickCollectionFile } from "./collectionParser";
import { sendMessage } from "./llmClient";

type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

type IncomingWebviewMessage =
  | { command: "loadCollection" }
  | { command: "sendMessage"; text?: string }
  | { command: "clearChat" };

export class PostchatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "postchatView";

  private view?: vscode.WebviewView;
  private conversationHistory: ConversationTurn[] = [];
  private collectionMarkdown: string | null = null;
  private collectionName: string | null = null;

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

      const parsed = parseCollectionWithStats(selectedPath);
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

      this.postToWebview({ command: "collectionLoaded", name: this.collectionName });
      this.postAssistantMessage(`Loaded collection **${this.collectionName}**.`);

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

    const apiKey = vscode.workspace
      .getConfiguration("postchat")
      .get<string>("apiKey", "")
      .trim();

    if (!apiKey) {
      this.postAssistantMessage(
        "No API key set. Go to Settings and set `postchat.apiKey`, then try again."
      );

      const action = "Open Settings";
      const selection = await vscode.window.showWarningMessage(
        "Postchat requires an Anthropic API key (postchat.apiKey).",
        action
      );

      if (selection === action) {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "postchat.apiKey"
        );
      }
      return;
    }

    this.postToWebview({ command: "addMessage", role: "user", text: userMessage });
    this.postToWebview({ command: "showThinking", value: true });

    try {
      const assistantResponse = await sendMessage({
        apiKey,
        collectionMarkdown: this.collectionMarkdown,
        conversationHistory: this.conversationHistory,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postAssistantMessage(`Request failed: ${message} Please retry.`);
    } finally {
      this.postToWebview({ command: "showThinking", value: false });
    }
  }

  private postAssistantMessage(text: string): void {
    this.postToWebview({ command: "addMessage", role: "assistant", text });
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
