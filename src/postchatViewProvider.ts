import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export class PostchatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "postchatView";

  constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    const { webview } = webviewView;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "webview-ui", "dist")
      ]
    };

    const builtHtml = this.getBuiltWebviewHtml(webview);
    webview.html = builtHtml ?? this.getPlaceholderHtml();
  }

  private getBuiltWebviewHtml(webview: vscode.Webview): string | undefined {
    const indexPath = path.join(
      this.extensionUri.fsPath,
      "webview-ui",
      "dist",
      "index.html"
    );

    if (!fs.existsSync(indexPath)) {
      return undefined;
    }

    let html = fs.readFileSync(indexPath, "utf8");

    const distUri = vscode.Uri.joinPath(this.extensionUri, "webview-ui", "dist");
    const distWebviewUri = webview.asWebviewUri(distUri).toString();

    // Vite outputs relative paths when base is "./". Prefix them with the webview URI root.
    html = html.replace(/(href|src)="\.\/(.*?)"/g, (_match, attr, fileName) => {
      return `${attr}="${distWebviewUri}/${fileName}"`;
    });

    return html;
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
