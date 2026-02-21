import { useEffect, useState } from "react";
import { useBridge } from "../../lib/explorerBridge";
import type { ParsedEndpoint } from "../../types/spec";
import type { ExecutionResult } from "../RequestResult";
import { ResponseViewer } from "./ResponseViewer";

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
  GET: "bg-blue-600/20 text-blue-400 border border-blue-600/30",
  POST: "bg-green-600/20 text-green-400 border border-green-600/30",
  PUT: "bg-orange-600/20 text-orange-400 border border-orange-600/30",
  PATCH: "bg-yellow-600/20 text-yellow-400 border border-yellow-600/30",
  DELETE: "bg-red-600/20 text-red-400 border border-red-600/30",
  HEAD: "bg-gray-600/20 text-gray-400 border border-gray-600/30",
  OPTIONS: "bg-gray-600/20 text-gray-400 border border-gray-600/30"
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
  const [showFullResponse, setShowFullResponse] = useState(false);

  useEffect(() => {
    if (!runResult) {
      setShowFullResponse(false);
    }
  }, [runResult]);

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-10"
      style={{
        background: "var(--vscode-editorWidget-background)",
        borderTop: "1px solid var(--vscode-widget-border)"
      }}
    >
      {runResult && showFullResponse ? (
        <div className="max-h-[45vh] overflow-auto border-b border-vscode-panelBorder px-3 py-2">
          <ResponseViewer result={runResult} error={runError} requestName={endpoint.name} />
        </div>
      ) : null}

      {runError && !runResult ? (
        <div className="border-b border-vscode-panelBorder px-3 py-2">
          <ResponseViewer result={null} error={runError} requestName={endpoint.name} />
        </div>
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
                      "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                      active
                        ? "border-vscode-buttonBg bg-vscode-buttonBg text-vscode-buttonFg"
                        : "border-vscode-inputBorder text-vscode-descriptionFg hover:bg-vscode-listHover"
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
        <span className={["rounded px-2 py-0.5 text-xs font-semibold", METHOD_BADGE_STYLES[endpoint.method]].join(" ")}>
          {endpoint.method}
        </span>
        <span className="max-w-[260px] truncate text-sm font-medium text-vscode-editorFg">{endpoint.name}</span>
        {!compact ? (
          <span className="text-xs text-vscode-descriptionFg">{`Selected: ${endpoint.method} ${endpoint.path}`}</span>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!runResult ? (
            <>
              <button
                type="button"
                disabled={!actionsEnabled}
                onClick={() => emit({ type: "runEndpoint", endpoint })}
                className={[
                  "rounded bg-vscode-buttonBg px-2.5 py-1 text-xs font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover",
                  !actionsEnabled ? "cursor-not-allowed opacity-50" : ""
                ].join(" ")}
                title={
                  actionsEnabled ? "Run endpoint" : `Method filter excludes ${endpoint.method} operations`
                }
              >
                {compact ? "▶" : "▶ Run"}
              </button>
              <button
                type="button"
                disabled={!actionsEnabled}
                onClick={() => {
                  emit({ type: "askAboutEndpoint", endpoint });
                  emit({ type: "switchToChat" });
                }}
                className={[
                  "rounded bg-vscode-buttonSecondaryBg px-2.5 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover",
                  !actionsEnabled ? "cursor-not-allowed opacity-50" : ""
                ].join(" ")}
                title={
                  actionsEnabled ? "Ask AI about endpoint" : `Method filter excludes ${endpoint.method} operations`
                }
              >
                {compact ? "💬" : "💬 Ask AI"}
              </button>
            </>
          ) : (
            <>
              <span className={["rounded px-2 py-0.5 text-xs font-semibold", getStatusBadge(runResult.status)].join(" ")}>
                {runResult.status}
              </span>
              <span className="text-xs text-vscode-descriptionFg">{runResult.durationMs}ms</span>
              <button
                type="button"
                onClick={() => setShowFullResponse((prev) => !prev)}
                className="rounded bg-vscode-buttonSecondaryBg px-2.5 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
              >
                {showFullResponse ? "Hide Response" : "View Full Response"}
              </button>
              <button
                type="button"
                onClick={() => {
                  emit({ type: "askAboutEndpoint", endpoint });
                  emit({ type: "switchToChat" });
                }}
                className="rounded bg-vscode-buttonBg px-2.5 py-1 text-xs font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover"
              >
                {compact ? "💬" : "Ask AI"}
              </button>
              <button
                type="button"
                onClick={onClearResult}
                className="rounded px-2 py-1 text-xs text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                aria-label="Clear run result"
              >
                ×
              </button>
            </>
          )}
        </div>
      </div>

      {!compact ? <div className="px-3 pb-2 text-[10px] text-vscode-descriptionFg">R to run · A to ask AI</div> : null}
    </div>
  );
}
