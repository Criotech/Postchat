import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Code2,
  Copy,
  LoaderCircle,
  MoreVertical,
  Play,
  RotateCcw,
  Save,
  Send,
  Sparkles
} from "lucide-react";
import type { RequestEditState } from "../types";
import { METHOD_COLORS } from "../utils";

type SnippetKind = "curl" | "fetch" | "python" | "axios";

type TabTopBarProps = {
  editState: RequestEditState;
  isRunning: boolean;
  isModified: boolean;
  flashUrlBar?: boolean;
  onMethodChange: (method: string) => void;
  onUrlChange: (url: string) => void;
  onSend: () => void;
  onAskAI: () => void;
  onResetToOriginal: () => void;
  onCopySnippet: (kind: SnippetKind) => void;
  onSaveToCollection: () => void;
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export function TabTopBar({
  editState,
  isRunning,
  isModified,
  flashUrlBar = false,
  onMethodChange,
  onUrlChange,
  onSend,
  onAskAI,
  onResetToOriginal,
  onCopySnippet,
  onSaveToCollection
}: TabTopBarProps): JSX.Element {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const methodColor = METHOD_COLORS[editState.method.toUpperCase()] ?? "#6B7280";
  const shortcutHint = useMemo(() => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    return isMac ? "⌘↵" : "Ctrl+↵";
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

  useEffect(() => {
    const handleCloseMenus = () => setIsMenuOpen(false);
    window.addEventListener("postchat:close-overflow-menus", handleCloseMenus as EventListener);
    return () =>
      window.removeEventListener("postchat:close-overflow-menus", handleCloseMenus as EventListener);
  }, []);

  return (
    <header className="border-b border-vscode-panelBorder px-3 py-2.5">
      {/* Main URL bar row */}
      <div className="flex items-stretch gap-0">
        {/* Method selector */}
        <div className="relative">
          <select
            value={editState.method}
            onChange={(event) => onMethodChange(event.target.value)}
            className="h-[36px] appearance-none rounded-l-md border border-r-0 pl-3 pr-7 font-mono text-[13px] font-bold text-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-vscode-focusBorder"
            style={{
              backgroundColor: methodColor,
              borderColor: methodColor
            }}
            aria-label="HTTP method"
          >
            {METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/70"
            aria-hidden="true"
          />
          {isModified ? (
            <span
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 bg-vscode-focusBorder"
              style={{ borderColor: "var(--vscode-editor-background)" }}
              title="Modified from original"
              aria-label="Modified from original"
            />
          ) : null}
        </div>

        {/* URL input */}
        <input
          id="postchat-request-url-input"
          value={editState.url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="Enter request URL"
          className={[
            "h-[36px] min-w-0 flex-1 border border-r-0 font-mono text-[13px] px-3",
            "focus:outline-none focus:ring-1 focus:ring-inset focus:ring-vscode-focusBorder",
            flashUrlBar ? "postchat-url-pulse" : ""
          ].join(" ")}
          style={{
            background: "var(--vscode-input-background)",
            color: "var(--vscode-input-foreground)",
            borderColor: "var(--vscode-input-border, var(--vscode-panel-border))"
          }}
          aria-label="Request URL"
        />

        {/* Send button */}
        <button
          type="button"
          onClick={onSend}
          disabled={isRunning}
          className="inline-flex h-[36px] items-center gap-1.5 rounded-r-md px-4 text-[13px] font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-70"
          style={{
            backgroundColor: isRunning ? "#6B7280" : "#3B82F6",
          }}
        >
          {isRunning ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
          {isRunning ? "Sending..." : "Send"}
        </button>
      </div>

      {/* Action row below URL bar */}
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onAskAI}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-vscode-editorFg hover:bg-vscode-listHover"
        >
          <Sparkles size={12} className="text-purple-400" />
          Ask AI
        </button>

        <Separator />

        <button
          type="button"
          onClick={onResetToOriginal}
          disabled={!isModified}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw size={11} />
          Reset
        </button>

        <span className="ml-auto text-[10px] text-vscode-descriptionFg">
          {shortcutHint} to send
        </span>

        <Separator />

        {/* More menu */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setIsMenuOpen((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-md p-1 text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
            aria-label="More actions"
          >
            <MoreVertical size={14} />
          </button>

          {isMenuOpen ? (
            <div
              className="absolute right-0 top-[calc(100%+4px)] z-30 min-w-[200px] rounded-md border border-vscode-panelBorder py-1 shadow-lg"
              style={{ background: "var(--vscode-menu-background, var(--vscode-editorWidget-background))" }}
            >
              <MenuSectionLabel>Code Snippets</MenuSectionLabel>
              <MenuButton
                icon={<Copy size={12} />}
                label="Copy as cURL"
                onClick={() => { onCopySnippet("curl"); setIsMenuOpen(false); }}
              />
              <MenuButton
                icon={<Code2 size={12} />}
                label="Copy as fetch"
                onClick={() => { onCopySnippet("fetch"); setIsMenuOpen(false); }}
              />
              <MenuButton
                icon={<Code2 size={12} />}
                label="Copy as Python"
                onClick={() => { onCopySnippet("python"); setIsMenuOpen(false); }}
              />
              <MenuButton
                icon={<Code2 size={12} />}
                label="Copy as axios"
                onClick={() => { onCopySnippet("axios"); setIsMenuOpen(false); }}
              />
              <MenuDivider />
              <MenuButton
                icon={<Save size={12} />}
                label="Save to Collection"
                disabled
                onClick={onSaveToCollection}
              />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function Separator() {
  return (
    <span
      className="mx-0.5 inline-block h-3.5 w-px shrink-0"
      style={{ background: "var(--vscode-panelSection-border, rgba(128,128,128,0.25))" }}
      aria-hidden="true"
    />
  );
}

function MenuSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-vscode-descriptionFg">
      {children}
    </div>
  );
}

function MenuDivider() {
  return (
    <div
      className="my-1 h-px"
      style={{ background: "var(--vscode-menu-separatorBackground, var(--vscode-panel-border))" }}
    />
  );
}

type MenuButtonProps = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
};

function MenuButton({ label, onClick, disabled = false, icon }: MenuButtonProps): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-vscode-editorFg hover:bg-vscode-listHover disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon ? <span className="text-vscode-descriptionFg">{icon}</span> : null}
      {label}
    </button>
  );
}
