import * as vscode from "vscode";
import { PostchatViewProvider } from "./postchatViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PostchatViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PostchatViewProvider.viewType, provider)
  );

  const startCommand = vscode.commands.registerCommand("postchat.start", () => {
    vscode.window.showInformationMessage("Postchat started.");
  });

  context.subscriptions.push(startCommand);
}

export function deactivate(): void {
  // Placeholder for cleanup logic.
}
