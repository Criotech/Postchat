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
  environmentName?: string;
  activeProvider?: string;
  activeModel?: string;
  onLoadCollection: () => void;
  onLoadEnvironment: () => void;
  onClearChat: () => void;
};

export function Header({
  collectionName,
  environmentName,
  activeProvider,
  activeModel,
  onLoadCollection,
  onLoadEnvironment,
  onClearChat
}: HeaderProps): JSX.Element {
  const providerLabel = activeProvider ? (PROVIDER_DISPLAY[activeProvider] ?? activeProvider) : null;
  const modelLabel = activeModel ? abbreviateModel(activeModel) : null;

  return (
    <header className="flex flex-col border-b border-vscode-panelBorder">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold">Postchat</h1>
          <div className="flex flex-col gap-1">
            {collectionName ? (
              <span className="w-fit rounded-full bg-vscode-badgeBg px-2 py-0.5 text-xs text-vscode-badgeFg">
                📦 {collectionName}
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
        </div>
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
