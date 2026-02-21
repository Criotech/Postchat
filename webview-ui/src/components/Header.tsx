const PROVIDER_DISPLAY: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  ollama: "Ollama"
};

function abbreviateModel(model: string): string {
  // Strip trailing date stamp from Anthropic model names (e.g. "claude-sonnet-4-5-20250929")
  return model.replace(/-\d{8}$/, "");
}

type HeaderProps = {
  collectionName?: string;
  collectionPath?: string;
  collectionSpecType: "postman" | "openapi3" | "swagger2";
  environmentName?: string;
  activeTab: "chat" | "explorer";
  activeProvider?: string;
  activeModel?: string;
  isSettingsOpen: boolean;
  onTabChange: (tab: "chat" | "explorer") => void;
  onLoadCollection: () => void;
  onLoadEnvironment: () => void;
  onClearChat: () => void;
  onSettingsToggle: () => void;
};

export function Header({
  collectionName,
  collectionPath,
  collectionSpecType,
  environmentName,
  activeTab,
  activeProvider,
  activeModel,
  isSettingsOpen,
  onTabChange,
  onLoadCollection,
  onLoadEnvironment,
  onClearChat,
  onSettingsToggle
}: HeaderProps): JSX.Element {
  const providerLabel = activeProvider ? (PROVIDER_DISPLAY[activeProvider] ?? activeProvider) : null;
  const modelLabel = activeModel ? abbreviateModel(activeModel) : null;
  const collectionIcon = collectionSpecType === "postman" ? "📦" : "📄";
  const isExplorerAvailable = Boolean(collectionName);

  const tabButtonClasses = (tab: "chat" | "explorer", isDisabled = false): string =>
    [
      "border-b-2 px-3 py-2 text-xs font-medium transition-colors",
      tab === activeTab
        ? "border-b-[var(--vscode-focusBorder)] text-[var(--vscode-tab-activeForeground)]"
        : "border-b-transparent text-[var(--vscode-tab-inactiveForeground)] hover:text-[var(--vscode-tab-activeForeground)]",
      isDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
    ].join(" ");

  return (
    <header className="flex flex-col border-b border-vscode-panelBorder">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold">Postchat</h1>
          <div className="flex flex-col gap-1">
            {collectionName ? (
              <span
                className="w-fit rounded-full bg-vscode-badgeBg px-2 py-0.5 text-xs text-vscode-badgeFg"
                title={collectionPath}
              >
                {collectionIcon} {collectionName}
              </span>
            ) : null}
            {environmentName ? (
              <span className="w-fit rounded-full bg-vscode-badgeBg px-2 py-0.5 text-xs text-vscode-badgeFg">
                🔑 {environmentName}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onLoadCollection}
            className="rounded bg-vscode-buttonBg px-2.5 py-1.5 text-xs font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
          >
            Load Collection
          </button>

          <button
            type="button"
            onClick={onLoadEnvironment}
            className="rounded border border-vscode-inputBorder bg-vscode-inputBg p-1.5 text-vscode-inputFg hover:bg-vscode-listHover focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
            aria-label="Load Environment"
            title={
              environmentName
                ? "Load Postman Environment"
                : "Load a Postman Environment file to resolve {{variables}}"
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="7.5" cy="15.5" r="5.5" />
              <path d="m21 2-9.6 9.6" />
              <path d="m15.5 7.5 3 3L22 7l-3-3" />
            </svg>
          </button>

          <button
            type="button"
            onClick={onClearChat}
            className="rounded border border-vscode-inputBorder bg-vscode-inputBg px-2.5 py-1.5 text-xs font-medium text-vscode-inputFg hover:bg-vscode-listHover focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
            aria-label="Clear Chat"
            title="Clear Chat"
          >
            Clear Chat
          </button>

          <button
            type="button"
            onClick={onSettingsToggle}
            aria-label="Settings"
            title="Provider &amp; Model Settings"
            className={[
              "rounded border p-1.5 focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder",
              isSettingsOpen
                ? "border-vscode-focusBorder bg-vscode-buttonBg text-vscode-buttonFg"
                : "border-vscode-inputBorder bg-vscode-inputBg text-vscode-inputFg hover:bg-vscode-listHover"
            ].join(" ")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-t border-vscode-panelBorder bg-[var(--vscode-editorGroupHeader-tabsBackground)] px-2">
        <button
          type="button"
          onClick={() => onTabChange("chat")}
          className={tabButtonClasses("chat")}
        >
          💬 Chat
        </button>
        <button
          type="button"
          aria-disabled={!isExplorerAvailable}
          title={isExplorerAvailable ? "Explorer" : "Load a collection to use the Explorer"}
          onClick={() => onTabChange("explorer")}
          className={tabButtonClasses("explorer", !isExplorerAvailable)}
        >
          🗂️ Explorer
        </button>
      </div>

      {providerLabel && modelLabel ? (
        <div className="flex items-center gap-1.5 border-t border-vscode-panelBorder bg-vscode-inputBg/40 px-3 py-1">
          <span className="text-xs text-vscode-descriptionFg">
            {providerLabel}
            <span className="mx-1 opacity-50">·</span>
            {modelLabel}
          </span>
        </div>
      ) : null}
    </header>
  );
}
