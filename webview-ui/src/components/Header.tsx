type HeaderProps = {
  collectionName?: string;
  onLoadCollection: () => void;
  onClearChat: () => void;
};

export function Header({
  collectionName,
  onLoadCollection,
  onClearChat
}: HeaderProps): JSX.Element {
  return (
    <header className="flex items-center justify-between border-b border-vscode-panelBorder px-3 py-2">
      <div className="flex items-center gap-2">
        <h1 className="text-base font-semibold">Postchat</h1>
        {collectionName ? (
          <span className="rounded-full bg-vscode-badgeBg px-2 py-0.5 text-xs text-vscode-badgeFg">
            📦 {collectionName}
          </span>
        ) : null}
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
          onClick={onClearChat}
          className="rounded p-1.5 text-vscode-inputFg hover:bg-vscode-listHover focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
          aria-label="Clear Chat"
          title="Clear Chat"
        >
          🗑
        </button>
      </div>
    </header>
  );
}
