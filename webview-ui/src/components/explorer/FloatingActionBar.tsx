import { useCallback } from "react";
import { Play, ExternalLink, MessageSquare, X } from "lucide-react";
import { useBridge } from "../../lib/explorerBridge";
import type { ParsedEndpoint } from "../../types/spec";
import { vscode } from "../../vscode";
import type { ExecutionResult } from "../RequestResult";

type FloatingActionBarProps = {
  endpoint: ParsedEndpoint;
  runResult: ExecutionResult | null;
  runError: string | null;
  onClearResult: () => void;
  compact?: boolean;
  pulse?: boolean;
  methodFilters?: {
    activeMethods: Array<"ALL" | ParsedEndpoint["method"]>;
    onToggle: (method: "ALL" | ParsedEndpoint["method"]) => void;
  };
  actionsEnabled?: boolean;
};

const METHOD_BADGE_STYLES: Record<ParsedEndpoint["method"], string> = {
  GET: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
  POST: "bg-green-500/15 text-green-400 border border-green-500/30",
  PUT: "bg-orange-500/15 text-orange-400 border border-orange-500/30",
  PATCH: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30",
  DELETE: "bg-red-500/15 text-red-400 border border-red-500/30",
  HEAD: "bg-gray-500/15 text-gray-400 border border-gray-500/30",
  OPTIONS: "bg-gray-500/15 text-gray-400 border border-gray-500/30"
};

function getStatusBadge(status: number): string {
  if (status >= 200 && status < 300) {
    return "bg-green-600/20 text-green-400 border border-green-600/30";
  }
  if (status >= 300 && status < 400) {
    return "bg-blue-600/20 text-blue-400 border border-blue-600/30";
  }
  if (status >= 400 && status < 500) {
    return "bg-orange-600/20 text-orange-400 border border-orange-600/30";
  }
  return "bg-red-600/20 text-red-400 border border-red-600/30";
}

export function FloatingActionBar({
  endpoint,
  runResult,
  runError,
  onClearResult,
  compact = false,
  pulse = false,
  methodFilters,
  actionsEnabled = true
}: FloatingActionBarProps): JSX.Element {
  const { emit } = useBridge();

  const openInTab = useCallback(() => {
    vscode.postMessage({ command: "openRequestTab", endpointId: endpoint.id });
  }, [endpoint.id]);

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-10"
      style={{
        background: "var(--vscode-editorWidget-background)",
        borderTop: "1px solid var(--vscode-widget-border)"
      }}
    >
      {runError && !runResult ? (
        <div className="border-b border-vscode-panelBorder px-3 py-2 text-xs text-red-300">{runError}</div>
      ) : null}

      {methodFilters ? (
        <div className="border-b border-vscode-panelBorder px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-1">
            {(["ALL", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const).map(
              (method) => {
                const active = methodFilters.activeMethods.includes(method);
                return (
                  <button
                    key={method}
                    type="button"
                    onClick={() => methodFilters.onToggle(method)}
                    className={[
                      "rounded px-2 py-0.5 text-[10px] font-semibold transition-colors",
                      active
                        ? "bg-vscode-buttonBg text-vscode-buttonFg"
                        : "text-vscode-descriptionFg hover:bg-vscode-listHover"
                    ].join(" ")}
                  >
                    {method}
                  </button>
                );
              }
            )}
          </div>
        </div>
      ) : null}

      <div
        className={[
          "flex flex-wrap items-center gap-2 px-3 py-2",
          pulse ? "postchat-fab-pulse" : ""
        ].join(" ")}
      >
        <span className={["rounded px-2 py-0.5 font-mono text-[10px] font-bold", METHOD_BADGE_STYLES[endpoint.method]].join(" ")}>
          {endpoint.method}
        </span>
        <span className="max-w-[260px] truncate text-xs font-medium text-vscode-editorFg">{endpoint.name}</span>
        {!compact ? (
          <span className="font-mono text-[11px] text-vscode-descriptionFg">{endpoint.path}</span>
        ) : null}

        {/* Divider */}
        <span
          className="mx-1 inline-block h-4 w-px shrink-0"
          style={{ background: "var(--vscode-panelSection-border, rgba(128,128,128,0.25))" }}
          aria-hidden="true"
        />

        <div className="ml-auto flex items-center gap-1.5">
          {!runResult ? (
            <>
              <button
                type="button"
                disabled={!actionsEnabled}
                onClick={() => emit({ type: "runEndpoint", endpoint })}
                className={[
                  "inline-flex items-center gap-1 rounded bg-vscode-buttonBg px-2.5 py-1 text-xs font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover",
                  !actionsEnabled ? "cursor-not-allowed opacity-50" : ""
                ].join(" ")}
                title={
                  actionsEnabled ? "Run endpoint" : `Method filter excludes ${endpoint.method} operations`
                }
              >
                <Play size={11} />
                {compact ? null : <span>Run</span>}
              </button>
              <button
                type="button"
                onClick={openInTab}
                className="inline-flex items-center gap-1 rounded bg-vscode-buttonSecondaryBg px-2.5 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
                title="Open endpoint in tab"
              >
                <ExternalLink size={11} />
                {compact ? null : <span>Open in Tab</span>}
              </button>
              <button
                type="button"
                disabled={!actionsEnabled}
                onClick={() => {
                  emit({ type: "askAboutEndpoint", endpoint });
                  emit({ type: "switchToChat" });
                }}
                className={[
                  "inline-flex items-center gap-1 rounded bg-vscode-buttonSecondaryBg px-2.5 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover",
                  !actionsEnabled ? "cursor-not-allowed opacity-50" : ""
                ].join(" ")}
                title={
                  actionsEnabled ? "Ask AI about endpoint" : `Method filter excludes ${endpoint.method} operations`
                }
              >
                <MessageSquare size={11} />
                {compact ? null : <span>Ask AI</span>}
              </button>
            </>
          ) : (
            <>
              <span className={["rounded px-2 py-0.5 font-mono text-[10px] font-bold", getStatusBadge(runResult.status)].join(" ")}>
                {runResult.status}
              </span>
              <span className="text-[11px] text-vscode-descriptionFg">{runResult.durationMs}ms</span>

              <span
                className="mx-0.5 inline-block h-4 w-px shrink-0"
                style={{ background: "var(--vscode-panelSection-border, rgba(128,128,128,0.25))" }}
                aria-hidden="true"
              />

              <button
                type="button"
                onClick={openInTab}
                className="inline-flex items-center gap-1 rounded bg-vscode-buttonSecondaryBg px-2.5 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
                title="Open endpoint in tab"
              >
                <ExternalLink size={11} />
                {compact ? null : <span>Open in Tab</span>}
              </button>
              <button
                type="button"
                onClick={() => {
                  emit({ type: "askAboutEndpoint", endpoint });
                  emit({ type: "switchToChat" });
                }}
                className="inline-flex items-center gap-1 rounded bg-vscode-buttonBg px-2.5 py-1 text-xs font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover"
              >
                <MessageSquare size={11} />
                {compact ? null : <span>Ask AI</span>}
              </button>
              <button
                type="button"
                onClick={onClearResult}
                className="rounded p-1 text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                aria-label="Clear run result"
              >
                <X size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {!compact ? (
        <div className="px-3 pb-1.5 text-[10px] text-vscode-descriptionFg">
          <kbd className="rounded border border-vscode-panelBorder px-1 py-[1px] text-[9px]">R</kbd> run
          <span className="mx-1.5">·</span>
          <kbd className="rounded border border-vscode-panelBorder px-1 py-[1px] text-[9px]">A</kbd> ask AI
        </div>
      ) : null}
    </div>
  );
}
