import { CollectionSwitcher } from "./CollectionSwitcher";
import type { SourceInfo, SourceStatus } from "./SourceManager";

const PROVIDER_DISPLAY: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  ollama: "Ollama"
};

type CollectionSpecType = "postman" | "openapi3" | "swagger2";
type CollectionSummary = {
  id: string;
  path: string;
  name: string;
  specType: CollectionSpecType;
  envName?: string;
};

function abbreviateModel(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

function statusDotColor(status: SourceStatus): string {
  switch (status) {
    case "connected":
      return "bg-green-500";
    case "syncing":
      return "bg-yellow-400 animate-pulse";
    case "disconnected":
      return "bg-gray-400";
    case "error":
      return "bg-red-500";
    case "stale":
      return "bg-orange-400";
  }
}

type HeaderProps = {
  collections: CollectionSummary[];
  activeCollectionId: string | null;
  isCollectionParsing?: boolean;
  activeTab: "chat" | "explorer";
  activeProvider?: string;
  activeModel?: string;
  isSettingsOpen: boolean;
  isSourceManagerOpen: boolean;
  activeSource: SourceInfo | null;
  onTabChange: (tab: "chat" | "explorer") => void;
  onLoadCollection: () => void;
  onSwitchCollection: (id: string) => void;
  onRemoveCollection: (id: string) => void;
  onLoadEnvironment: () => void;
  onClearChat: () => void;
  onSettingsToggle: () => void;
  onSourceManagerToggle: () => void;
};

export function Header({
  collections,
  activeCollectionId,
  isCollectionParsing = false,
  activeTab,
  activeProvider,
  activeModel,
  isSettingsOpen,
  isSourceManagerOpen,
  activeSource,
  onTabChange,
  onLoadCollection,
  onSwitchCollection,
  onRemoveCollection,
  onLoadEnvironment,
  onClearChat,
  onSettingsToggle,
  onSourceManagerToggle
}: HeaderProps): JSX.Element {
  const providerLabel = activeProvider ? (PROVIDER_DISPLAY[activeProvider] ?? activeProvider) : null;
  const modelLabel = activeModel ? abbreviateModel(activeModel) : null;
  const activeCollection =
    (activeCollectionId
      ? collections.find((collection) => collection.id === activeCollectionId)
      : null) ?? null;
  const isExplorerAvailable = Boolean(activeCollection) || isCollectionParsing;

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
      <div className="flex items-start justify-between gap-3 px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="text-base font-semibold">Postchat</h1>
          {collections.length > 0 ? (
            <CollectionSwitcher
              collections={collections}
              activeCollectionId={activeCollection?.id ?? collections[0].id}
              onSwitchCollection={onSwitchCollection}
              onRemoveCollection={onRemoveCollection}
              onLoadCollection={onLoadCollection}
            />
          ) : (
            <div className="flex items-center justify-center gap-2 rounded border border-dashed border-vscode-panelBorder bg-vscode-inputBg/40 px-3 py-2">
              <button
                type="button"
                onClick={onSourceManagerToggle}
                className="rounded bg-vscode-buttonBg px-2.5 py-1.5 text-xs font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
              >
                Connect API
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Source Manager toggle */}
          <button
            type="button"
            onClick={onSourceManagerToggle}
            aria-label="Source Manager"
            title="Manage collection sources"
            className={[
              "relative rounded border p-1.5 focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder",
              isSourceManagerOpen
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
              <path d="M4 11a9 9 0 0 1 9 9" />
              <path d="M4 4a16 16 0 0 1 16 16" />
              <circle cx="5" cy="19" r="1" />
            </svg>
            {activeSource ? (
              <span
                className={[
                  "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-vscode-editorBg",
                  statusDotColor(activeSource.status)
                ].join(" ")}
              />
            ) : null}
          </button>

          <button
            type="button"
            onClick={onLoadEnvironment}
            disabled={!activeCollection}
            className="rounded border border-vscode-inputBorder bg-vscode-inputBg p-1.5 text-vscode-inputFg hover:bg-vscode-listHover focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Load Environment"
            title={
              activeCollection
                ? "Load Postman Environment for the active collection"
                : "Load a collection first to attach an environment"
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

      {/* Active source status bar */}
      {activeSource ? (
        <div className="flex items-center gap-1.5 border-t border-vscode-panelBorder bg-vscode-inputBg/40 px-3 py-1">
          <span className={["h-1.5 w-1.5 shrink-0 rounded-full", statusDotColor(activeSource.status)].join(" ")} />
          <span className="truncate text-[10px] text-vscode-descriptionFg">
            {activeSource.label}
            {activeSource.status === "syncing" ? " — Syncing..." : ""}
            {activeSource.status === "error" ? " — Error" : ""}
          </span>
        </div>
      ) : null}

      <div className="flex items-center gap-1 border-t border-vscode-panelBorder bg-[var(--vscode-editorGroupHeader-tabsBackground)] px-2">
        <button
          type="button"
          onClick={() => onTabChange("chat")}
          className={tabButtonClasses("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          aria-disabled={!isExplorerAvailable}
          title={isExplorerAvailable ? "Explorer" : "Load a collection to use the Explorer"}
          onClick={() => onTabChange("explorer")}
          className={tabButtonClasses("explorer", !isExplorerAvailable)}
        >
          Explorer
        </button>
      </div>

      {providerLabel && modelLabel ? (
        <div className="flex items-center gap-1.5 border-t border-vscode-panelBorder bg-vscode-inputBg/40 px-3 py-1">
          <span className="text-xs text-vscode-descriptionFg">
            {providerLabel}
            <span className="mx-1 opacity-50">&middot;</span>
            {modelLabel}
          </span>
        </div>
      ) : null}
    </header>
  );
}
