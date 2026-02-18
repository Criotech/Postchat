type VsCodeApi<TState = unknown> = {
  postMessage: (message: unknown) => void;
  setState: (newState: TState) => void;
  getState: () => TState | undefined;
};

declare global {
  interface Window {
    acquireVsCodeApi?: <TState = unknown>() => VsCodeApi<TState>;
  }
}

const fallbackApi: VsCodeApi = {
  postMessage: () => {
    // No-op outside VS Code webview.
  },
  setState: () => {
    // No-op outside VS Code webview.
  },
  getState: () => undefined
};

const vscode: VsCodeApi =
  typeof window !== "undefined" && typeof window.acquireVsCodeApi === "function"
    ? window.acquireVsCodeApi()
    : fallbackApi;

export { vscode };
