import { useEffect, useMemo, useState } from "react";
import { ImageIcon, LoaderCircle, Search, Send, WrapText } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ExecutionResult, RequestEditState } from "../types";
import { bytesToKb } from "../utils";

type ResponseTab = "body" | "headers" | "raw" | "ai";

type AiHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

type ResponsePanelProps = {
  editState: RequestEditState;
  runResult: ExecutionResult | null;
  runError: string | null;
  isRunning: boolean;
  activeResponseTab: ResponseTab;
  onChangeResponseTab: (tab: ResponseTab) => void;
  aiResponse: string | null;
  isAiLoading: boolean;
  onAiResponseConsumed: () => void;
  onAskAI: (prompt: string, history: AiHistoryTurn[]) => void;
};

const MAX_PREVIEW_BYTES = 50 * 1024;
const MAX_PREVIEW_CHARS = 10 * 1024;

export function ResponsePanel({
  editState,
  runResult,
  runError,
  isRunning,
  activeResponseTab,
  onChangeResponseTab,
  aiResponse,
  isAiLoading,
  onAiResponseConsumed,
  onAskAI
}: ResponsePanelProps): JSX.Element {
  const [showFullResponse, setShowFullResponse] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [aiMessages, setAiMessages] = useState<AiHistoryTurn[]>([]);
  const [aiInput, setAiInput] = useState("");

  useEffect(() => {
    if (!aiResponse) {
      return;
    }

    setAiMessages((prev) => [...prev, { role: "assistant", content: aiResponse }]);
    onAiResponseConsumed();
  }, [aiResponse, onAiResponseConsumed]);

  useEffect(() => {
    setShowFullResponse(false);
    if (runResult) {
      onChangeResponseTab("body");
    }
  }, [runResult, onChangeResponseTab]);

  const responseSizeKb = runResult ? bytesToKb(runResult.body) : 0;
  const responseSizeBytes = responseSizeKb * 1024;
  const hasLargeResponse = responseSizeBytes > MAX_PREVIEW_BYTES;

  const displayBody = useMemo(() => {
    if (!runResult) {
      return "";
    }
    if (showFullResponse || !hasLargeResponse) {
      return runResult.body;
    }
    return runResult.body.slice(0, MAX_PREVIEW_CHARS);
  }, [hasLargeResponse, runResult, showFullResponse]);

  const contentType = (runResult?.headers?.["content-type"] ?? runResult?.headers?.["Content-Type"] ?? "").toLowerCase();
  const detectedLanguage = detectLanguage(contentType, runResult?.body ?? "");
  const searchMatchCount = countSearchMatches(displayBody, searchText);

  const sendAiPrompt = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || isAiLoading) {
      return;
    }

    const nextHistory = [...aiMessages, { role: "user" as const, content: trimmed }];
    setAiMessages(nextHistory);
    onChangeResponseTab("ai");
    onAskAI(trimmed, nextHistory);
    setAiInput("");
  };

  const showEmptyState = !runResult && aiMessages.length === 0 && !isAiLoading;

  return (
    <section className="flex h-full min-h-0 flex-col bg-vscode-editorBg">
      {showEmptyState ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-vscode-muted">
          <Send size={54} strokeWidth={1.2} />
          <p className="text-sm font-medium">Send a request to see the response</p>
          <p className="max-w-sm text-xs">Or click Ask AI to get help with this endpoint</p>
        </div>
      ) : (
        <>
          <nav className="flex border-b border-vscode-panelBorder px-2 pt-2 text-xs">
            <ResponseTabButton
              active={activeResponseTab === "body"}
              label="Response"
              badge={runResult ? `${responseSizeKb} KB` : undefined}
              onClick={() => onChangeResponseTab("body")}
            />
            <ResponseTabButton
              active={activeResponseTab === "headers"}
              label="Headers"
              badge={runResult ? String(Object.keys(runResult.headers).length) : undefined}
              onClick={() => onChangeResponseTab("headers")}
            />
            <ResponseTabButton
              active={activeResponseTab === "raw"}
              label="Raw"
              onClick={() => onChangeResponseTab("raw")}
            />
            <ResponseTabButton
              active={activeResponseTab === "ai"}
              label="AI Assistant"
              badge={aiMessages.length > 0 ? String(aiMessages.length) : undefined}
              onClick={() => onChangeResponseTab("ai")}
            />
          </nav>

          <div className="min-h-0 flex-1 overflow-hidden p-3">
            {activeResponseTab === "body" ? (
              <div className="flex h-full min-h-0 flex-col gap-2">
                {runResult ? (
                  <>
                    <StatusBar result={runResult} sizeKb={responseSizeKb} />

                    <div className="flex flex-wrap items-center gap-2 rounded border border-vscode-panelBorder bg-vscode-card px-2 py-1">
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(runResult.body)}
                        className="rounded border border-vscode-panelBorder px-2 py-0.5 text-xs hover:bg-vscode-listHover"
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        onClick={() => setWordWrap((prev) => !prev)}
                        className="inline-flex items-center gap-1 rounded border border-vscode-panelBorder px-2 py-0.5 text-xs hover:bg-vscode-listHover"
                      >
                        <WrapText size={12} />
                        Word Wrap
                      </button>
                      <div className="ml-auto inline-flex items-center gap-1">
                        <Search size={12} className="text-vscode-muted" />
                        <input
                          value={searchText}
                          onChange={(event) => setSearchText(event.target.value)}
                          placeholder="Search in response"
                          className="rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs"
                        />
                        {searchText ? <span className="text-[11px] text-vscode-muted">{searchMatchCount}</span> : null}
                      </div>
                    </div>

                    {contentType.startsWith("text/html") ? (
                      <p className="text-xs text-vscode-muted">HTML response detected. Open in browser if you need rendering.</p>
                    ) : null}

                    {contentType.startsWith("image/") && runResult.body.startsWith("data:image") ? (
                      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded border border-vscode-panelBorder bg-vscode-card p-3">
                        <img src={runResult.body} alt="Response content" className="max-w-full" />
                      </div>
                    ) : contentType.startsWith("image/") ? (
                      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded border border-vscode-panelBorder bg-vscode-card p-3 text-vscode-muted">
                        <ImageIcon size={26} />
                        <p className="text-xs">Image response received. Binary preview is unavailable in this view.</p>
                      </div>
                    ) : (
                      <div className="min-h-0 flex-1 overflow-auto rounded border border-vscode-panelBorder">
                        <SyntaxHighlighter
                          language={detectedLanguage}
                          style={vscDarkPlus}
                          wrapLongLines={wordWrap}
                          customStyle={{ margin: 0, minHeight: "100%", fontSize: "0.78rem" }}
                        >
                          {displayBody || "(empty response)"}
                        </SyntaxHighlighter>
                      </div>
                    )}

                    {hasLargeResponse && !showFullResponse ? (
                      <button
                        type="button"
                        onClick={() => setShowFullResponse(true)}
                        className="self-start rounded border border-vscode-panelBorder px-2 py-1 text-xs hover:bg-vscode-listHover"
                      >
                        Show full response ({responseSizeKb} KB)
                      </button>
                    ) : null}
                  </>
                ) : isRunning ? (
                  <LoadingState label="Waiting for response..." />
                ) : runError ? (
                  <p className="rounded border border-vscode-errorBorder bg-vscode-errorBg p-2 text-sm text-vscode-errorFg">
                    {runError}
                  </p>
                ) : (
                  <p className="text-xs text-vscode-muted">No response yet.</p>
                )}
              </div>
            ) : null}

            {activeResponseTab === "headers" ? (
              <div className="flex h-full min-h-0 flex-col gap-2">
                {!runResult ? (
                  <p className="text-xs text-vscode-muted">No headers available yet.</p>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(JSON.stringify(runResult.headers, null, 2))}
                      className="self-start rounded border border-vscode-panelBorder px-2 py-1 text-xs hover:bg-vscode-listHover"
                    >
                      Copy all as JSON
                    </button>
                    <div className="min-h-0 flex-1 overflow-auto rounded border border-vscode-panelBorder">
                      <table className="w-full border-collapse text-xs">
                        <thead className="sticky top-0 bg-vscode-card">
                          <tr>
                            <th className="border-b border-vscode-panelBorder px-2 py-1 text-left">Header</th>
                            <th className="border-b border-vscode-panelBorder px-2 py-1 text-left">Value</th>
                            <th className="border-b border-vscode-panelBorder px-2 py-1 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(runResult.headers).map(([key, value]) => (
                            <tr key={key}>
                              <td className="border-b border-vscode-panelBorder px-2 py-1 font-mono">{key}</td>
                              <td className="border-b border-vscode-panelBorder px-2 py-1 font-mono">{value}</td>
                              <td className="border-b border-vscode-panelBorder px-2 py-1 text-right">
                                <button
                                  type="button"
                                  onClick={() => navigator.clipboard.writeText(value)}
                                  className="rounded border border-vscode-panelBorder px-1.5 py-0.5 text-[11px] hover:bg-vscode-listHover"
                                >
                                  Copy
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {activeResponseTab === "raw" ? (
              <div className="flex h-full min-h-0 flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!runResult) {
                      return;
                    }
                    navigator.clipboard.writeText(buildRawHttpResponse(runResult));
                  }}
                  className="self-start rounded border border-vscode-panelBorder px-2 py-1 text-xs hover:bg-vscode-listHover"
                >
                  Copy All
                </button>
                <textarea
                  readOnly
                  value={runResult ? buildRawHttpResponse(runResult) : ""}
                  className="h-full min-h-0 w-full resize-none rounded border border-vscode-panelBorder bg-vscode-card p-2 font-mono text-xs focus:outline-none"
                />
              </div>
            ) : null}

            {activeResponseTab === "ai" ? (
              <div className="flex h-full min-h-0 flex-col gap-2">
                {aiMessages.length === 0 && !isAiLoading ? (
                  <div className="flex flex-wrap gap-2">
                    {buildQuickActions(runResult).map((label) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => sendAiPrompt(label)}
                        className="rounded-full border border-vscode-panelBorder px-2 py-1 text-xs hover:bg-vscode-listHover"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-auto rounded border border-vscode-panelBorder bg-vscode-card p-2">
                  {aiMessages.length === 0 && !isAiLoading ? (
                    <p className="text-xs text-vscode-muted">Ask for help about this request and response.</p>
                  ) : (
                    <div className="space-y-3">
                      {aiMessages.map((message, index) => (
                        <article key={`ai-${index}`} className="space-y-1">
                          <p className="text-[11px] uppercase tracking-wide text-vscode-muted">{message.role}</p>
                          {message.role === "assistant" ? (
                            <div className="prose prose-sm max-w-none text-vscode-editorFg">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                            </div>
                          ) : (
                            <p className="text-sm">{message.content}</p>
                          )}
                        </article>
                      ))}
                      {isAiLoading ? <LoadingState label="Thinking..." compact /> : null}
                    </div>
                  )}
                </div>

                <div className="flex items-end gap-2 rounded border border-vscode-inputBorder bg-vscode-inputBg p-2">
                  <textarea
                    rows={1}
                    value={aiInput}
                    onChange={(event) => setAiInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        sendAiPrompt(aiInput);
                      }
                    }}
                    placeholder="Ask about this endpoint"
                    className="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-sm focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => sendAiPrompt(aiInput)}
                    disabled={!aiInput.trim() || isAiLoading}
                    className="rounded bg-vscode-buttonBg px-3 py-1.5 text-xs text-vscode-buttonFg hover:bg-vscode-buttonHover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function StatusBar({ result, sizeKb }: { result: ExecutionResult; sizeKb: number }): JSX.Element {
  const statusStyle =
    result.status >= 400
      ? {
          backgroundColor: "var(--vscode-inputValidation-errorBackground)",
          color: "var(--vscode-inputValidation-errorForeground)",
          borderColor: "var(--vscode-inputValidation-errorBorder)"
        }
      : result.status >= 300
        ? {
            backgroundColor: "var(--vscode-editorWidget-background)",
            color: "var(--vscode-editor-foreground)",
            borderColor: "var(--vscode-focusBorder)"
          }
        : {
            backgroundColor: "var(--vscode-button-secondaryBackground)",
            color: "var(--vscode-button-secondaryForeground)",
            borderColor: "var(--vscode-panel-border)"
          };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-vscode-panelBorder bg-vscode-card px-2 py-1 text-xs">
      <span
        className="rounded border px-2 py-0.5 font-medium"
        style={statusStyle}
      >
        {result.status}
      </span>
      <span className="font-medium">{result.statusText || "Unknown"}</span>
      <span className="ml-auto text-vscode-muted">{result.durationMs} ms</span>
      <span className="text-vscode-muted">{sizeKb} KB</span>
    </div>
  );
}

function ResponseTabButton({
  active,
  label,
  badge,
  onClick
}: {
  active: boolean;
  label: string;
  badge?: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "mb-[-1px] inline-flex items-center gap-1 border-b px-2 py-1.5",
        active
          ? "border-vscode-focusBorder text-vscode-editorFg"
          : "border-transparent text-vscode-muted hover:text-vscode-editorFg"
      ].join(" ")}
    >
      {label}
      {badge ? <span className="rounded bg-vscode-badgeBg px-1 py-0.5 text-[10px] text-vscode-badgeFg">{badge}</span> : null}
    </button>
  );
}

function buildRawHttpResponse(result: ExecutionResult): string {
  const headers = Object.entries(result.headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  return [`HTTP ${result.status} ${result.statusText}`, headers, "", result.body].join("\n");
}

function detectLanguage(contentType: string, body: string): string {
  if (contentType.includes("application/json")) {
    return "json";
  }
  if (contentType.includes("xml")) {
    return "xml";
  }
  if (contentType.includes("html")) {
    return "html";
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

function countSearchMatches(value: string, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return 0;
  }

  const source = value.toLowerCase();
  let count = 0;
  let index = 0;

  while (index !== -1) {
    index = source.indexOf(needle, index);
    if (index === -1) {
      break;
    }
    count += 1;
    index += needle.length;
  }

  return count;
}

function LoadingState({ label, compact = false }: { label: string; compact?: boolean }): JSX.Element {
  return (
    <div className={compact ? "inline-flex items-center gap-2 text-xs" : "flex h-full items-center justify-center gap-2 text-sm"}>
      <LoaderCircle size={compact ? 14 : 18} className="animate-spin" />
      <span>{label}</span>
    </div>
  );
}

function buildQuickActions(result: ExecutionResult | null): string[] {
  const prompts = [
    "Explain this response",
    "Why did I get this status code?",
    "Show me how to handle this in JavaScript",
    "What does this response body mean?"
  ];

  if (result && result.status >= 400) {
    prompts.push("How do I fix this error?");
  }

  return prompts;
}
