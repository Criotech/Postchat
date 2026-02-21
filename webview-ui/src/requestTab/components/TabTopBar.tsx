import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, MoreVertical, Play, Sparkles } from "lucide-react";
import type { RequestEditState } from "../types";
import { METHOD_COLORS } from "../utils";

type SnippetKind = "curl" | "fetch" | "python" | "axios";

type TabTopBarProps = {
  editState: RequestEditState;
  isRunning: boolean;
  onMethodChange: (method: string) => void;
  onUrlChange: (url: string) => void;
  onSend: () => void;
  onAskAI: () => void;
  onCopySnippet: (kind: SnippetKind) => void;
  onSaveToCollection: () => void;
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export function TabTopBar({
  editState,
  isRunning,
  onMethodChange,
  onUrlChange,
  onSend,
  onAskAI,
  onCopySnippet,
  onSaveToCollection
}: TabTopBarProps): JSX.Element {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const methodColor = METHOD_COLORS[editState.method.toUpperCase()] ?? "#6B7280";
  const shortcutHint = useMemo(() => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    return isMac ? "Cmd+Enter" : "Ctrl+Enter";
  }, []);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const onClickAway = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", onClickAway);
    return () => window.removeEventListener("mousedown", onClickAway);
  }, [isMenuOpen]);

  return (
    <header className="border-b border-vscode-panelBorder bg-vscode-editorBg px-3 py-2">
      <div className="flex items-center gap-2">
        <select
          value={editState.method}
          onChange={(event) => onMethodChange(event.target.value)}
          className="h-10 rounded border px-3 text-sm font-semibold text-white focus:outline-none"
          style={{
            backgroundColor: methodColor,
            borderColor: "color-mix(in srgb, var(--vscode-panel-border) 70%, transparent)"
          }}
          aria-label="HTTP method"
        >
          {METHODS.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>

        <input
          value={editState.url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="Enter request URL"
          className="h-10 min-w-0 flex-1 rounded border border-vscode-inputBorder bg-vscode-inputBg px-3 text-sm text-vscode-inputFg placeholder:text-vscode-placeholder focus:border-vscode-focusBorder focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
          aria-label="Request URL"
        />

        <button
          type="button"
          onClick={onSend}
          disabled={isRunning}
          className="inline-flex h-10 items-center gap-2 rounded bg-vscode-buttonBg px-3 text-sm font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isRunning ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={15} />}
          {isRunning ? "Sending" : "Send"}
          <span className="text-[11px] opacity-75">{shortcutHint}</span>
        </button>

        <button
          type="button"
          onClick={onAskAI}
          className="inline-flex h-10 items-center gap-2 rounded bg-vscode-buttonSecondaryBg px-3 text-sm font-medium text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
        >
          <Sparkles size={15} />
          Ask AI
        </button>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setIsMenuOpen((prev) => !prev)}
            className="inline-flex h-10 w-10 items-center justify-center rounded border border-vscode-panelBorder bg-vscode-editorBg text-vscode-editorFg hover:bg-vscode-listHover"
            aria-label="More actions"
          >
            <MoreVertical size={16} />
          </button>

          {isMenuOpen ? (
            <div className="absolute right-0 top-[calc(100%+0.4rem)] z-30 min-w-52 rounded border border-vscode-panelBorder bg-vscode-editorBg p-1 shadow-lg">
              <MenuButton
                label="Copy as curl"
                onClick={() => {
                  onCopySnippet("curl");
                  setIsMenuOpen(false);
                }}
              />
              <MenuButton
                label="Copy as fetch"
                onClick={() => {
                  onCopySnippet("fetch");
                  setIsMenuOpen(false);
                }}
              />
              <MenuButton
                label="Copy as Python"
                onClick={() => {
                  onCopySnippet("python");
                  setIsMenuOpen(false);
                }}
              />
              <MenuButton
                label="Copy as axios"
                onClick={() => {
                  onCopySnippet("axios");
                  setIsMenuOpen(false);
                }}
              />
              <MenuButton label="Save to Collection" disabled onClick={onSaveToCollection} />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

type MenuButtonProps = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

function MenuButton({ label, onClick, disabled = false }: MenuButtonProps): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="block w-full rounded px-2 py-1.5 text-left text-xs text-vscode-editorFg hover:bg-vscode-listHover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}
