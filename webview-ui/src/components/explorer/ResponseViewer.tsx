import { useCallback, useMemo, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { ExecutionResult } from "../RequestResult";
import { vscode } from "../../vscode";

type ResponseViewerProps = {
  result: ExecutionResult | null;
  requestName: string;
  onSendToAI?: (prompt: string) => void;
};

type ResponseTab = "body" | "headers" | "raw";

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

function normalizeHeaders(headers: Record<string, string>): Array<[string, string]> {
  return Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
}

function getContentType(headers: Record<string, string>): string {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type");
  return entry?.[1] ?? "";
}

function buildSendToAiPrompt(
  result: ExecutionResult,
  requestName: string
): string {
  const bodyPreview = result.body.slice(0, 500);
  return `I got a ${result.status} ${result.statusText} response from ${requestName}.\nCan you help me understand this response?\nResponse body: ${bodyPreview}`;
}

export function ResponseViewer({
  result,
  requestName,
  onSendToAI
}: ResponseViewerProps): JSX.Element | null {
  const [activeTab, setActiveTab] = useState<ResponseTab>("body");
  const [copiedBody, setCopiedBody] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [copiedHeader, setCopiedHeader] = useState<string | null>(null);

  const responseBody = result?.body ?? "";

  const headers = useMemo(() => {
    return result ? normalizeHeaders(result.headers) : [];
  }, [result]);

  const contentType = useMemo(() => {
    return result ? getContentType(result.headers).toLowerCase() : "";
  }, [result]);

  const isJson = useMemo(() => {
    if (!result) {
      return false;
    }

    if (contentType.includes("json")) {
      return true;
    }

    const trimmed = responseBody.trimStart();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
  }, [contentType, responseBody, result]);

  const formattedJson = useMemo(() => {
    if (!isJson) {
      return null;
    }

    try {
      const parsed = JSON.parse(responseBody);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return responseBody;
    }
  }, [isJson, responseBody]);

  const handleCopy = useCallback(async (value: string, kind: "body" | "raw" | "header", key?: string) => {
    await navigator.clipboard.writeText(value);

    if (kind === "body") {
      setCopiedBody(true);
      window.setTimeout(() => setCopiedBody(false), 1200);
      return;
    }

    if (kind === "raw") {
      setCopiedRaw(true);
      window.setTimeout(() => setCopiedRaw(false), 1200);
      return;
    }

    if (key) {
      setCopiedHeader(key);
      window.setTimeout(() => setCopiedHeader((current) => (current === key ? null : current)), 1200);
    }
  }, []);

  const handleSendToAI = useCallback(() => {
    if (!result) {
      return;
    }

    const prompt = buildSendToAiPrompt(result, requestName);

    if (onSendToAI) {
      onSendToAI(prompt);
      return;
    }

    window.dispatchEvent(
      new CustomEvent("postchat:switchTab", {
        detail: { tab: "chat" }
      })
    );
    vscode.postMessage({ command: "sendMessage", text: prompt });
  }, [onSendToAI, requestName, result]);

  if (!result) {
    return null;
  }

  const tabButton = (tab: ResponseTab, label: string): JSX.Element => (
    <button
      key={tab}
      type="button"
      onClick={() => setActiveTab(tab)}
      className={[
        "rounded px-2 py-1 text-xs font-medium",
        activeTab === tab
          ? "bg-vscode-buttonBg text-vscode-buttonFg"
          : "bg-vscode-inputBg text-vscode-inputFg hover:bg-vscode-listHover"
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <section className="rounded border border-vscode-panelBorder bg-vscode-editorBg">
      <div className="flex flex-wrap items-center gap-2 border-b border-vscode-panelBorder px-3 py-2">
        <span className={["rounded px-2 py-0.5 text-xs font-semibold", getStatusBadge(result.status)].join(" ")}>
          {result.status}
        </span>
        <span className="text-sm font-medium text-vscode-editorFg">{result.statusText}</span>
        <span className="ml-auto text-xs text-vscode-descriptionFg">{result.durationMs}ms</span>
        <span className="text-xs text-vscode-descriptionFg">{result.body.length} bytes</span>
      </div>

      <div className="flex items-center gap-1 border-b border-vscode-panelBorder px-3 py-2">
        {tabButton("body", "Body")}
        {tabButton("headers", "Headers")}
        {tabButton("raw", "Raw")}
      </div>

      {activeTab === "body" ? (
        <div className="p-3">
          <div className="mb-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void handleCopy(result.body, "body")}
              className="rounded bg-vscode-buttonSecondaryBg px-2 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
            >
              {copiedBody ? "Copied" : "Copy Body"}
            </button>
            <button
              type="button"
              onClick={handleSendToAI}
              className="rounded bg-vscode-buttonBg px-2 py-1 text-xs font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover"
            >
              Send to AI
            </button>
          </div>

          <div className="max-h-[320px] overflow-auto rounded border border-vscode-panelBorder">
            {isJson ? (
              <SyntaxHighlighter
                language="json"
                style={vscDarkPlus}
                customStyle={{ margin: 0, fontSize: "0.75rem", background: "transparent" }}
              >
                {formattedJson ?? result.body}
              </SyntaxHighlighter>
            ) : (
              <pre className="m-0 whitespace-pre-wrap px-3 py-2 font-mono text-xs text-vscode-editorFg">
                {result.body || "(empty)"}
              </pre>
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "headers" ? (
        <div className="max-h-[320px] overflow-auto p-3">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-vscode-panelBorder text-vscode-descriptionFg">
                <th className="px-2 py-1 font-medium">Header</th>
                <th className="px-2 py-1 font-medium">Value</th>
                <th className="w-10 px-2 py-1" aria-label="Copy" />
              </tr>
            </thead>
            <tbody>
              {headers.map(([key, value]) => (
                <tr key={key} className="border-b border-vscode-panelBorder/50">
                  <td className="px-2 py-1 text-vscode-descriptionFg">{key}</td>
                  <td className="px-2 py-1 font-mono text-vscode-editorFg">{value}</td>
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => void handleCopy(`${key}: ${value}`, "header", key)}
                      className="rounded px-1 py-0.5 text-[11px] hover:bg-vscode-listHover"
                      title="Copy header"
                    >
                      {copiedHeader === key ? "✓" : "⧉"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {activeTab === "raw" ? (
        <div className="p-3">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => void handleCopy(result.body, "raw")}
              className="rounded bg-vscode-buttonSecondaryBg px-2 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
            >
              {copiedRaw ? "Copied" : "Copy All"}
            </button>
          </div>
          <textarea
            value={result.body}
            readOnly
            className="h-52 w-full resize-y rounded border border-vscode-panelBorder bg-vscode-inputBg px-2 py-1 font-mono text-xs text-vscode-inputFg"
          />
        </div>
      ) : null}
    </section>
  );
}
