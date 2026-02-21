import { useEffect, useState } from "react";
import type { ParsedEndpoint } from "../../types/spec";
import type { ExecutionResult } from "../RequestResult";
import { ResponseViewer } from "./ResponseViewer";

type FloatingActionBarProps = {
  endpoint: ParsedEndpoint;
  runResult: ExecutionResult | null;
  onRunRequest: () => void | Promise<void>;
  onAskAI: () => void;
  onClearResult: () => void;
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
  onRunRequest,
  onAskAI,
  onClearResult
}: FloatingActionBarProps): JSX.Element {
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
          <ResponseViewer result={runResult} requestName={endpoint.name} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className={["rounded px-2 py-0.5 text-xs font-semibold", METHOD_BADGE_STYLES[endpoint.method]].join(" ")}>
          {endpoint.method}
        </span>
        <span className="max-w-[260px] truncate text-sm font-medium text-vscode-editorFg">{endpoint.name}</span>
        <span className="text-xs text-vscode-descriptionFg">{`Selected: ${endpoint.method} ${endpoint.path}`}</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!runResult ? (
            <>
              <button
                type="button"
                onClick={() => void onRunRequest()}
                className="rounded bg-vscode-buttonBg px-2.5 py-1 text-xs font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover"
              >
                ▶ Run
              </button>
              <button
                type="button"
                onClick={onAskAI}
                className="rounded bg-vscode-buttonSecondaryBg px-2.5 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
              >
                💬 Ask AI
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
                onClick={onAskAI}
                className="rounded bg-vscode-buttonBg px-2.5 py-1 text-xs font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover"
              >
                Ask AI
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
    </div>
  );
}
