import { useCallback, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { vscode } from "../vscode";

export type ExecutableRequest = {
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
};

export type ExecutionResult = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
};

type RequestResultProps = {
  request: ExecutableRequest;
  result: ExecutionResult;
  onViewInExplorer?: () => void;
};

function getMethodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "bg-green-700 text-white";
    case "POST":
      return "bg-blue-700 text-white";
    case "PUT":
      return "bg-yellow-700 text-white";
    case "PATCH":
      return "bg-orange-700 text-white";
    case "DELETE":
      return "bg-red-700 text-white";
    default:
      return "bg-gray-600 text-white";
  }
}

function getStatusColor(status: number): string {
  if (status >= 200 && status < 300) {
    return "text-green-400";
  }
  if (status >= 400) {
    return "text-red-400";
  }
  return "text-yellow-400";
}

function detectLanguage(body: string, headers: Record<string, string>): string {
  const contentType = headers["content-type"] ?? "";
  if (contentType.includes("json")) {
    return "json";
  }
  if (contentType.includes("xml") || contentType.includes("html")) {
    return "xml";
  }

  const trimmed = body.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "json";
  }
  if (trimmed.startsWith("<")) {
    return "xml";
  }

  return "text";
}

export function RequestResult({
  request,
  result,
  onViewInExplorer
}: RequestResultProps): JSX.Element {
  const [showHeaders, setShowHeaders] = useState(false);
  const [showBody, setShowBody] = useState(true);
  const [copied, setCopied] = useState(false);

  const handleCopyResponse = useCallback(async () => {
    await navigator.clipboard.writeText(result.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [result.body]);

  const handleRerun = useCallback(() => {
    vscode.postMessage({ command: "executeRequest", request });
  }, [request]);

  const language = detectLanguage(result.body, result.headers);
  const headerEntries = Object.entries(result.headers);

  return (
    <article className="mr-auto max-w-[90%] rounded-lg border border-vscode-panelBorder bg-vscode-card text-sm text-vscode-editorFg">
      {/* Top bar: method, URL, status, duration */}
      <div className="flex flex-wrap items-center gap-2 border-b border-vscode-panelBorder px-3 py-2">
        <span
          className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${getMethodColor(request.method)}`}
        >
          {request.method}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs opacity-80">{request.url}</span>
        <span className={`font-bold ${getStatusColor(result.status)}`}>
          {result.status} {result.statusText}
        </span>
        <span className="text-xs opacity-60">{result.durationMs}ms</span>
      </div>

      {/* Collapsible response headers */}
      <div className="border-b border-vscode-panelBorder">
        <button
          type="button"
          onClick={() => setShowHeaders((prev) => !prev)}
          className="w-full px-3 py-1.5 text-left text-xs font-medium opacity-70 hover:opacity-100"
        >
          {showHeaders ? "▾" : "▸"} Response Headers ({headerEntries.length})
        </button>
        {showHeaders && (
          <div className="px-3 pb-2">
            <div className="rounded bg-vscode-editorBg p-2 font-mono text-xs">
              {headerEntries.map(([key, value]) => (
                <div key={key}>
                  <span className="opacity-60">{key}:</span> {value}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Collapsible response body */}
      <div>
        <button
          type="button"
          onClick={() => setShowBody((prev) => !prev)}
          className="w-full px-3 py-1.5 text-left text-xs font-medium opacity-70 hover:opacity-100"
        >
          {showBody ? "▾" : "▸"} Response Body
        </button>
        {showBody && (
          <div className="px-3 pb-2">
            <div className="overflow-auto rounded border border-vscode-panelBorder">
              <SyntaxHighlighter
                language={language}
                style={vscDarkPlus}
                customStyle={{ margin: 0, fontSize: "0.75rem", maxHeight: "300px" }}
              >
                {result.body || "(empty)"}
              </SyntaxHighlighter>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 border-t border-vscode-panelBorder px-3 py-2">
        <button
          type="button"
          onClick={handleCopyResponse}
          className="rounded bg-vscode-buttonSecondaryBg px-2 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
        >
          {copied ? "Copied!" : "Copy Response"}
        </button>
        <button
          type="button"
          onClick={onViewInExplorer}
          className="rounded bg-vscode-buttonSecondaryBg px-2 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
        >
          View in Explorer
        </button>
        <button
          type="button"
          onClick={handleRerun}
          className="rounded bg-vscode-buttonSecondaryBg px-2 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
        >
          Re-run
        </button>
      </div>
    </article>
  );
}
