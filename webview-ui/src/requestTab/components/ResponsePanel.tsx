import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Clock,
  Copy,
  HardDrive,
  ImageIcon,
  LoaderCircle,
  MessageSquare,
  Search,
  Send,
  WrapText,
  X
} from "lucide-react";
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
  const [copiedBody, setCopiedBody] = useState(false);

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

  const handleCopyBody = () => {
    if (!runResult) return;
    navigator.clipboard.writeText(runResult.body);
    setCopiedBody(true);
    setTimeout(() => setCopiedBody(false), 1200);
  };

  const showEmptyState = !runResult && aiMessages.length === 0 && !isAiLoading;

  return (
    <section className="flex h-full min-h-0 flex-col">
      {showEmptyState ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-xl"
            style={{ background: "var(--vscode-editorWidget-background)" }}
          >
            <Send size={24} strokeWidth={1.2} className="text-vscode-descriptionFg" />
          </div>
          <p className="text-sm font-medium text-vscode-editorFg">Send a request to see the response</p>
          <p className="max-w-xs text-xs text-vscode-descriptionFg">
            Or click Ask AI to get help with this endpoint
          </p>
        </div>
      ) : (
        <>
          {/* Tabs + status summary in one bar */}
          <div className="flex items-end border-b border-vscode-panelBorder">
            <nav className="flex text-[12px]">
              <ResponseTabButton
                active={activeResponseTab === "body"}
                label="Body"
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
                label="AI"
                badge={aiMessages.length > 0 ? String(aiMessages.length) : undefined}
                onClick={() => onChangeResponseTab("ai")}
              />
            </nav>

            {/* Status chips on the right */}
            {runResult ? (
              <div className="ml-auto flex items-center gap-2 px-3 pb-1.5">
                <StatusChip
                  status={runResult.status}
                  text={`${runResult.status} ${runResult.statusText || ""}`}
                />
                <div className="flex items-center gap-1 text-[11px] text-vscode-descriptionFg">
                  <Clock size={11} />
                  <span>{runResult.durationMs} ms</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-vscode-descriptionFg">
                  <HardDrive size={11} />
                  <span>{responseSizeKb} KB</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {activeResponseTab === "body" ? (
              <div className="flex h-full min-h-0 flex-col">
                {runResult ? (
                  <>
                    {/* Toolbar */}
                    <div className="flex items-center gap-1 border-b border-vscode-panelBorder px-3 py-1.5">
                      <button
                        type="button"
                        onClick={handleCopyBody}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                      >
                        {copiedBody ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                        {copiedBody ? "Copied" : "Copy"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setWordWrap((prev) => !prev)}
                        className={[
                          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] transition-colors",
                          wordWrap
                            ? "bg-vscode-listHover text-vscode-editorFg"
                            : "text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                        ].join(" ")}
                      >
                        <WrapText size={11} />
                        Wrap
                      </button>

                      <div className="ml-auto inline-flex items-center gap-1 rounded-md border border-transparent focus-within:border-vscode-focusBorder">
                        <Search size={11} className="ml-2 text-vscode-descriptionFg" />
                        <input
                          value={searchText}
                          onChange={(event) => setSearchText(event.target.value)}
                          placeholder="Search"
                          className="w-28 bg-transparent px-1.5 py-0.5 text-[11px] focus:outline-none"
                        />
                        {searchText ? (
                          <>
                            <span className="text-[10px] text-vscode-descriptionFg">{searchMatchCount}</span>
                            <button
                              type="button"
                              onClick={() => setSearchText("")}
                              className="mr-1 rounded p-0.5 text-vscode-descriptionFg hover:text-vscode-editorFg"
                            >
                              <X size={10} />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>

                    {contentType.startsWith("text/html") ? (
                      <p className="border-b border-vscode-panelBorder px-3 py-1.5 text-[11px] text-vscode-descriptionFg">
                        HTML response detected. Open in browser for rendering.
                      </p>
                    ) : null}

                    {contentType.startsWith("image/") && runResult.body.startsWith("data:image") ? (
                      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
                        <img src={runResult.body} alt="Response content" className="max-w-full" />
                      </div>
                    ) : contentType.startsWith("image/") ? (
                      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-vscode-descriptionFg">
                        <ImageIcon size={26} />
                        <p className="text-xs">Binary image preview is unavailable in this view.</p>
                      </div>
                    ) : (
                      <div className="min-h-0 flex-1 overflow-auto">
                        <SyntaxHighlighter
                          language={detectedLanguage}
                          style={vscDarkPlus}
                          wrapLongLines={wordWrap}
                          customStyle={{ margin: 0, minHeight: "100%", fontSize: "12px", lineHeight: "18px" }}
                        >
                          {displayBody || "(empty response)"}
                        </SyntaxHighlighter>
                      </div>
                    )}

                    {hasLargeResponse && !showFullResponse ? (
                      <div className="border-t border-vscode-panelBorder px-3 py-1.5">
                        <button
                          type="button"
                          onClick={() => setShowFullResponse(true)}
                          className="text-[11px] text-vscode-linkFg hover:underline"
                        >
                          Show full response ({responseSizeKb} KB)
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : isRunning ? (
                  <LoadingState label="Waiting for response..." />
                ) : runError ? (
                  <div className="p-3">
                    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                      {runError}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-xs text-vscode-descriptionFg">No response yet.</p>
                  </div>
                )}
              </div>
            ) : null}

            {activeResponseTab === "headers" ? (
              <div className="flex h-full min-h-0 flex-col">
                {!runResult ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-xs text-vscode-descriptionFg">No headers available yet.</p>
                  </div>
                ) : (
                  <>
                    <div className="border-b border-vscode-panelBorder px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(JSON.stringify(runResult.headers, null, 2))}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                      >
                        <Copy size={11} />
                        Copy all as JSON
                      </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr
                            className="sticky top-0 border-b border-vscode-panelBorder text-[10px] font-semibold uppercase tracking-wider text-vscode-descriptionFg"
                            style={{ background: "var(--vscode-editorWidget-background)" }}
                          >
                            <th className="px-3 py-1.5 text-left font-semibold">Key</th>
                            <th className="px-3 py-1.5 text-left font-semibold">Value</th>
                            <th className="w-12 px-2 py-1.5 text-right font-semibold" />
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(runResult.headers).map(([key, value]) => (
                            <tr key={key} className="group border-b border-vscode-panelBorder last:border-b-0 hover:bg-vscode-listHover">
                              <td className="px-3 py-1.5 font-mono text-vscode-editorFg">{key}</td>
                              <td className="px-3 py-1.5 font-mono text-vscode-descriptionFg">{value}</td>
                              <td className="px-2 py-1.5 text-right">
                                <button
                                  type="button"
                                  onClick={() => navigator.clipboard.writeText(value)}
                                  className="rounded p-0.5 text-vscode-descriptionFg opacity-0 transition-opacity group-hover:opacity-100 hover:text-vscode-editorFg"
                                  aria-label={`Copy ${key}`}
                                >
                                  <Copy size={12} />
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
              <div className="flex h-full min-h-0 flex-col">
                <div className="border-b border-vscode-panelBorder px-3 py-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (!runResult) return;
                      navigator.clipboard.writeText(buildRawHttpResponse(runResult));
                    }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                  >
                    <Copy size={11} />
                    Copy All
                  </button>
                </div>
                <textarea
                  readOnly
                  value={runResult ? buildRawHttpResponse(runResult) : ""}
                  className="min-h-0 flex-1 resize-none border-0 p-3 font-mono text-xs leading-[18px] focus:outline-none"
                  style={{
                    background: "var(--vscode-input-background)",
                    color: "var(--vscode-input-foreground)"
                  }}
                />
              </div>
            ) : null}

            {activeResponseTab === "ai" ? (
              <div className="flex h-full min-h-0 flex-col">
                {aiMessages.length === 0 && !isAiLoading ? (
                  <div className="border-b border-vscode-panelBorder px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {buildQuickActions(runResult).map((label) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => sendAiPrompt(label)}
                          className="rounded-md border border-vscode-panelBorder px-2 py-1 text-[11px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Chat area */}
                <div className="min-h-0 flex-1 overflow-auto p-3">
                  {aiMessages.length === 0 && !isAiLoading ? (
                    <div className="flex flex-col items-center gap-2 py-6 text-center">
                      <MessageSquare size={24} strokeWidth={1.2} className="text-vscode-descriptionFg" />
                      <p className="text-xs text-vscode-descriptionFg">
                        Ask for help about this request and response.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {aiMessages.map((message, index) => (
                        <div
                          key={`ai-${index}`}
                          className={[
                            "rounded-lg px-3 py-2",
                            message.role === "user"
                              ? ""
                              : ""
                          ].join(" ")}
                          style={
                            message.role === "user"
                              ? { background: "var(--vscode-editorWidget-background)" }
                              : undefined
                          }
                        >
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-vscode-descriptionFg">
                            {message.role === "user" ? "You" : "AI"}
                          </p>
                          {message.role === "assistant" ? (
                            <div className="prose prose-sm max-w-none text-xs text-vscode-editorFg">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                            </div>
                          ) : (
                            <p className="text-xs text-vscode-editorFg">{message.content}</p>
                          )}
                        </div>
                      ))}
                      {isAiLoading ? <LoadingState label="Thinking..." compact /> : null}
                    </div>
                  )}
                </div>

                {/* Input */}
                <div className="border-t border-vscode-panelBorder p-2">
                  <div
                    className="flex items-end gap-2 rounded-md border border-vscode-inputBorder px-2 py-1.5"
                    style={{ background: "var(--vscode-input-background)" }}
                  >
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
                      placeholder="Ask about this endpoint..."
                      className="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-xs focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => sendAiPrompt(aiInput)}
                      disabled={!aiInput.trim() || isAiLoading}
                      className="rounded-md bg-vscode-buttonBg p-1.5 text-vscode-buttonFg hover:bg-vscode-buttonHover disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Send size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

/* ── Subcomponents ── */

function StatusChip({ status, text }: { status: number; text: string }) {
  let colorClass = "bg-green-500/15 text-green-400 border-green-500/30";
  if (status >= 400) {
    colorClass = "bg-red-500/15 text-red-400 border-red-500/30";
  } else if (status >= 300) {
    colorClass = "bg-blue-500/15 text-blue-400 border-blue-500/30";
  }

  return (
    <span className={`rounded-md border px-2 py-[2px] font-mono text-[11px] font-bold ${colorClass}`}>
      {text}
    </span>
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
        "relative inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors",
        active
          ? "text-vscode-editorFg"
          : "text-vscode-descriptionFg hover:text-vscode-editorFg"
      ].join(" ")}
    >
      {label}
      {badge ? (
        <span className="rounded-full bg-vscode-badgeBg px-1.5 text-[9px] leading-[16px] text-vscode-badgeFg">
          {badge}
        </span>
      ) : null}
      {active ? (
        <span
          className="absolute bottom-0 left-2 right-2 h-[2px] rounded-t"
          style={{ background: "var(--vscode-focusBorder)" }}
        />
      ) : null}
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
    <div className={compact ? "inline-flex items-center gap-2 px-3 py-2 text-xs" : "flex h-full items-center justify-center gap-2 text-sm"}>
      <LoaderCircle size={compact ? 14 : 18} className="animate-spin text-vscode-descriptionFg" />
      <span className="text-vscode-descriptionFg">{label}</span>
    </div>
  );
}

function buildQuickActions(result: ExecutionResult | null): string[] {
  const prompts = [
    "Explain this response",
    "Why this status code?",
    "Handle in JavaScript",
    "What does the body mean?"
  ];

  if (result && result.status >= 400) {
    prompts.push("How to fix this error?");
  }

  return prompts;
}
