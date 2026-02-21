import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParsedCollection, ParsedEndpoint } from "../types/spec";
import { vscode } from "../vscode";
import { RequestPanel, type PanelTab } from "./components/RequestPanel";
import { ResponsePanel } from "./components/ResponsePanel";
import { TabTopBar } from "./components/TabTopBar";
import type {
  ExecutableRequest,
  ExecutionResult,
  KeyValueRow,
  RequestEditState,
  RequestTabIncomingMessage
} from "./types";
import {
  buildInitialEditState,
  buildUrlFromState,
  inferContentType,
  parseQueryRows,
  removeHeader,
  removeQuery,
  upsertHeader,
  upsertQuery
} from "./utils";

type ResponseTab = "body" | "headers" | "raw" | "ai";
type SnippetKind = "curl" | "fetch" | "python" | "axios";
type AiHistoryTurn = { role: "user" | "assistant"; content: string };

type PendingOAuthRequest = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
};

const MIN_PANEL_WIDTH = 300;

const EMPTY_EDIT_STATE: RequestEditState = {
  method: "GET",
  url: "",
  pathParams: {},
  queryParams: [],
  headers: [],
  body: "",
  contentType: "none",
  authType: "none",
  authValue: ""
};

export default function RequestTabApp(): JSX.Element {
  const [endpoint, setEndpoint] = useState<ParsedEndpoint | null>(null);
  const [collection, setCollection] = useState<ParsedCollection | null>(null);
  const [environment, setEnvironment] = useState<Record<string, string>>({});
  const [editState, setEditState] = useState<RequestEditState>(EMPTY_EDIT_STATE);
  const [urlTemplate, setUrlTemplate] = useState("");
  const [originalEditState, setOriginalEditState] = useState<RequestEditState | null>(null);
  const [originalUrlTemplate, setOriginalUrlTemplate] = useState("");
  const [runResult, setRunResult] = useState<ExecutionResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [activeResponseTab, setActiveResponseTab] = useState<ResponseTab>("body");
  const [activeRequestTab, setActiveRequestTab] = useState<PanelTab>("params");
  const [pendingOAuthRequest, setPendingOAuthRequest] = useState<PendingOAuthRequest | null>(null);
  const [showCollectionReloadBanner, setShowCollectionReloadBanner] = useState(false);
  const [collectionReloadError, setCollectionReloadError] = useState<string | null>(null);
  const [isRefreshingEndpointData, setIsRefreshingEndpointData] = useState(false);
  const [flashUrlBar, setFlashUrlBar] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const [isSplitHandleHovered, setIsSplitHandleHovered] = useState(false);
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const sendHandlerRef = useRef<() => void>(() => {});
  const isRunningRef = useRef(false);

  useEffect(() => {
    vscode.postMessage({ command: "tabReady" });

    const handleMessage = (event: MessageEvent<RequestTabIncomingMessage>) => {
      const message = event.data;
      if (!message || typeof message !== "object" || !("command" in message)) {
        return;
      }

      switch (message.command) {
        case "loadEndpoint": {
          setEndpoint(message.endpoint);
          setCollection(message.collection);
          const nextEnvironment = message.environmentVariables ?? {};
          setEnvironment(nextEnvironment);
          const initial = buildInitialEditState(message.endpoint, nextEnvironment);
          setEditState(initial.state);
          setUrlTemplate(initial.urlTemplate);
          setOriginalEditState(initial.state);
          setOriginalUrlTemplate(initial.urlTemplate);
          setRunResult(null);
          setRunError(null);
          setAiResponse(null);
          setIsAiLoading(false);
          setIsRunning(false);
          isRunningRef.current = false;
          setActiveRequestTab("params");
          setActiveResponseTab("body");
          setPendingOAuthRequest(null);
          setShowCollectionReloadBanner(false);
          setCollectionReloadError(null);
          setIsRefreshingEndpointData(false);
          break;
        }
        case "requestComplete": {
          setRunResult(message.result);
          setRunError(null);
          setIsRunning(false);
          isRunningRef.current = false;
          setIsRefreshingEndpointData(false);

          if (pendingOAuthRequest) {
            const accessToken = tryExtractAccessToken(message.result.body);
            if (accessToken) {
              const oauthValue = JSON.stringify({ ...pendingOAuthRequest, token: accessToken });
              handleAuthChange("oauth2", oauthValue);
            }
            setPendingOAuthRequest(null);
          }
          break;
        }
        case "requestError":
          setRunError(message.error || "Request failed.");
          setIsRunning(false);
          isRunningRef.current = false;
          setPendingOAuthRequest(null);
          setIsRefreshingEndpointData(false);
          break;
        case "aiResponse":
        case "askAIResponse":
          setAiResponse(message.text);
          setIsAiLoading(false);
          setActiveResponseTab("ai");
          break;
        case "askAIError":
          setAiResponse(`Request-scoped AI failed: ${message.error}`);
          setIsAiLoading(false);
          setActiveResponseTab("ai");
          break;
        case "showThinking":
          setIsAiLoading(message.value);
          if (message.value) {
            setActiveResponseTab("ai");
          }
          break;
        case "collectionReloaded":
          setShowCollectionReloadBanner(true);
          setCollectionReloadError(null);
          setIsRefreshingEndpointData(false);
          break;
        case "flashHighlight":
          if (flashTimerRef.current !== null) {
            window.clearTimeout(flashTimerRef.current);
          }
          setFlashUrlBar(true);
          flashTimerRef.current = window.setTimeout(() => {
            setFlashUrlBar(false);
            flashTimerRef.current = null;
          }, 700);
          break;
        case "endpointRefreshUnavailable":
          setCollectionReloadError(message.error || "Could not refresh endpoint data.");
          setIsRefreshingEndpointData(false);
          break;
        case "triggerRunRequest":
          sendHandlerRef.current();
          break;
        default:
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
      isRunningRef.current = false;
    };
  }, [pendingOAuthRequest]);

  const enabledHeaders = useMemo(() => {
    return editState.headers.filter((header) => header.enabled && header.key.trim());
  }, [editState.headers]);

  const isModified = useMemo(() => {
    if (!originalEditState) {
      return false;
    }
    return !areEditStatesEqual(editState, originalEditState);
  }, [editState, originalEditState]);

  const buildExecutableRequest = useCallback((): ExecutableRequest | null => {
    if (!endpoint) {
      return null;
    }

    const headers = enabledHeaders.reduce<Record<string, string>>((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    const request: ExecutableRequest = {
      name: endpoint.id,
      method: editState.method,
      url: editState.url,
      headers
    };

    if (!isMethodBodyless(editState.method) && editState.body.trim()) {
      request.body = editState.body;
    }

    return request;
  }, [editState.body, editState.method, editState.url, enabledHeaders, endpoint]);

  const handleSend = useCallback(() => {
    if (isRunningRef.current) {
      return;
    }

    const request = buildExecutableRequest();
    if (!request) {
      return;
    }

    isRunningRef.current = true;
    setIsRunning(true);
    setRunError(null);
    setActiveResponseTab("body");
    vscode.postMessage({ command: "executeRequest", request });
  }, [buildExecutableRequest]);

  useEffect(() => {
    sendHandlerRef.current = handleSend;
  }, [handleSend]);

  const handleResetToOriginal = useCallback(() => {
    if (!originalEditState) {
      return;
    }

    setEditState(originalEditState);
    setUrlTemplate(originalUrlTemplate);
    setRunError(null);
  }, [originalEditState, originalUrlTemplate]);

  const handleRefreshEndpointData = useCallback(() => {
    setIsRefreshingEndpointData(true);
    setCollectionReloadError(null);
    vscode.postMessage({ command: "refreshEndpointData" });
  }, []);

  const updateSplitRatioFromClientX = useCallback((clientX: number) => {
    const container = splitContainerRef.current;
    if (!container) {
      return;
    }

    const bounds = container.getBoundingClientRect();
    if (bounds.width <= MIN_PANEL_WIDTH * 2) {
      setSplitRatio(0.5);
      return;
    }

    const minRatio = MIN_PANEL_WIDTH / bounds.width;
    const maxRatio = 1 - minRatio;
    const nextRatio = (clientX - bounds.left) / bounds.width;
    setSplitRatio(Math.min(maxRatio, Math.max(minRatio, nextRatio)));
  }, []);

  useEffect(() => {
    if (!isResizingSplit) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      updateSplitRatioFromClientX(event.clientX);
    };
    const handleMouseUp = () => {
      setIsResizingSplit(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingSplit, updateSplitRatioFromClientX]);

  useEffect(() => {
    const updateCompactMode = () => {
      setIsCompactLayout(window.innerWidth < 900);
    };
    updateCompactMode();
    window.addEventListener("resize", updateCompactMode);
    return () => window.removeEventListener("resize", updateCompactMode);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const hasMetaModifier = event.metaKey || event.ctrlKey;

      if (hasMetaModifier && key === "enter") {
        event.preventDefault();
        handleSend();
        return;
      }

      if (hasMetaModifier && key === "k") {
        event.preventDefault();
        const urlInput = document.getElementById("postchat-request-url-input");
        if (urlInput instanceof HTMLInputElement) {
          urlInput.focus();
          urlInput.select();
        }
        return;
      }

      if (hasMetaModifier && key === "1") {
        event.preventDefault();
        setActiveRequestTab("params");
        return;
      }

      if (hasMetaModifier && key === "2") {
        event.preventDefault();
        setActiveRequestTab("headers");
        return;
      }

      if (hasMetaModifier && key === "3") {
        event.preventDefault();
        setActiveRequestTab("body");
        return;
      }

      if (hasMetaModifier && key === "4") {
        event.preventDefault();
        setActiveRequestTab("auth");
        return;
      }

      if (key === "escape") {
        window.dispatchEvent(new CustomEvent("postchat:close-overflow-menus"));
        setRunResult(null);
        setRunError(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSend]);

  const handleMethodChange = (method: string) => {
    setEditState((prev) => ({ ...prev, method }));
  };

  const handleUrlChange = (url: string) => {
    setUrlTemplate(url);
    setEditState((prev) => ({
      ...prev,
      url,
      queryParams: parseQueryRows(url)
    }));
  };

  const handlePathParamChange = (key: string, value: string) => {
    setEditState((prev) => {
      const pathParams = { ...prev.pathParams, [key]: value };
      const url = buildUrlFromState(urlTemplate, pathParams, prev.queryParams);
      return {
        ...prev,
        pathParams,
        url
      };
    });
  };

  const handleQueryParamsChange = (rows: KeyValueRow[]) => {
    setEditState((prev) => ({
      ...prev,
      queryParams: rows,
      url: buildUrlFromState(urlTemplate, prev.pathParams, rows)
    }));
  };

  const handleHeadersChange = (rows: KeyValueRow[]) => {
    setEditState((prev) => ({
      ...prev,
      headers: rows,
      contentType: inferContentType(rows, prev.contentType)
    }));
  };

  const handleContentTypeChange = (contentType: string) => {
    setEditState((prev) => {
      let headers = [...prev.headers];
      const mime = contentTypeToMime(contentType);
      if (mime) {
        headers = upsertHeader(headers, "Content-Type", mime);
      } else {
        headers = removeHeader(headers, "Content-Type");
      }

      return {
        ...prev,
        contentType,
        headers
      };
    });
  };

  const handleAuthChange = useCallback(
    (authType: string, authValue: string) => {
      setEditState((prev) => {
        const next = applyAuth(prev, authType, authValue);
        return {
          ...next,
          url: buildUrlFromState(urlTemplate, next.pathParams, next.queryParams)
        };
      });
    },
    [urlTemplate]
  );

  const handleOAuthTokenRequest = (tokenUrl: string, clientId: string, clientSecret: string) => {
    if (!tokenUrl.trim()) {
      setRunError("OAuth token URL is required.");
      return;
    }

    if (isRunningRef.current) {
      return;
    }

    isRunningRef.current = true;
    setIsRunning(true);
    setRunError(null);
    setPendingOAuthRequest({ tokenUrl, clientId, clientSecret });
    setActiveResponseTab("body");

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret
    }).toString();

    vscode.postMessage({
      command: "executeRequest",
      request: {
        name: "__oauth2_token__",
        method: "POST",
        url: tokenUrl,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body
      }
    });
  };

  const handleAskAi = useCallback(
    (prompt: string, history: AiHistoryTurn[] = []) => {
      const requestContext = {
        method: editState.method,
        url: editState.url,
        headers: enabledHeaders.reduce<Record<string, string>>((acc, row) => {
          acc[row.key] = row.value;
          return acc;
        }, {}),
        body: editState.body
      };

      const responseContext = runResult
        ? {
            status: runResult.status,
            statusText: runResult.statusText,
            headers: runResult.headers,
            body: runResult.body.slice(0, 2000)
          }
        : null;

      const contextualPrompt = [
        "The user is working on the following API request and response. Help them understand and work with it.",
        `User question: ${prompt}`,
        "",
        "Request context:",
        JSON.stringify(requestContext, null, 2),
        "",
        "Response context:",
        responseContext ? JSON.stringify(responseContext, null, 2) : "No response yet."
      ].join("\n");

      setIsAiLoading(true);
      setAiResponse(null);
      setActiveResponseTab("ai");
      vscode.postMessage({
        command: "askAI",
        text: contextualPrompt,
        endpoint,
        context: editState,
        history
      });
    },
    [editState, enabledHeaders, endpoint, runResult]
  );

  const handleCopySnippet = async (kind: SnippetKind) => {
    const request = buildExecutableRequest();
    if (!request) {
      return;
    }

    const snippet = renderSnippet(kind, request);
    await navigator.clipboard.writeText(snippet);
    vscode.postMessage({ command: "copySnippet", format: kind });
  };

  const handleSaveToCollection = () => {
    vscode.postMessage({ command: "saveToCollection" });
  };

  const collectionSubtitle = collection
    ? `${collection.title} (${collection.endpoints.length} endpoints)`
    : "No collection loaded";

  return (
    <div className="flex h-full min-h-0 flex-col bg-vscode-editorBg text-vscode-editorFg">
      <TabTopBar
        editState={editState}
        isRunning={isRunning}
        isModified={isModified}
        flashUrlBar={flashUrlBar}
        onMethodChange={handleMethodChange}
        onUrlChange={handleUrlChange}
        onSend={handleSend}
        onAskAI={() => handleAskAi("Help me improve this request before sending it.")}
        onResetToOriginal={handleResetToOriginal}
        onCopySnippet={handleCopySnippet}
        onSaveToCollection={handleSaveToCollection}
      />

      {showCollectionReloadBanner ? (
        <div className="border-b border-vscode-panelBorder bg-vscode-editorWidget-background px-3 py-2 text-xs">
          <p className="text-vscode-editorFg">
            The collection has been reloaded.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRefreshEndpointData}
              disabled={isRefreshingEndpointData}
              className="rounded bg-vscode-buttonBg px-2.5 py-1 text-xs text-vscode-buttonFg hover:bg-vscode-buttonHover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRefreshingEndpointData ? "Refreshing..." : "Refresh endpoint data"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCollectionReloadBanner(false);
                setCollectionReloadError(null);
                setIsRefreshingEndpointData(false);
              }}
              className="rounded bg-vscode-buttonSecondaryBg px-2.5 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
            >
              Keep current edits
            </button>
            {collectionReloadError ? (
              <span className="text-vscode-errorFg">{collectionReloadError}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className="flex items-center gap-1.5 border-b border-vscode-panelBorder px-3 py-1 text-[11px] text-vscode-descriptionFg"
        style={{ background: "var(--vscode-editorWidget-background)" }}
      >
        <span className="font-medium text-vscode-editorFg">{endpoint?.name ?? "No endpoint selected"}</span>
        <span className="mx-0.5 inline-block h-3 w-px shrink-0" style={{ background: "var(--vscode-panelSection-border, rgba(128,128,128,0.25))" }} aria-hidden="true" />
        <span>{collectionSubtitle}</span>
        {Object.keys(environment).length > 0 ? (
          <>
            <span className="mx-0.5 inline-block h-3 w-px shrink-0" style={{ background: "var(--vscode-panelSection-border, rgba(128,128,128,0.25))" }} aria-hidden="true" />
            <span>{Object.keys(environment).length} env vars</span>
          </>
        ) : null}
      </div>

      <main
        ref={splitContainerRef}
        className={`flex min-h-0 flex-1 overflow-hidden ${isCompactLayout ? "flex-col" : ""}`}
      >
        <div
          className="min-h-0 min-w-[300px] overflow-hidden"
          style={
            isCompactLayout
              ? undefined
              : { width: `calc(${(splitRatio * 100).toFixed(2)}% - 2px)` }
          }
        >
          <RequestPanel
            endpoint={endpoint}
            editState={editState}
            activeTab={activeRequestTab}
            onActiveTabChange={setActiveRequestTab}
            onPathParamChange={handlePathParamChange}
            onQueryParamsChange={handleQueryParamsChange}
            onHeadersChange={handleHeadersChange}
            onBodyChange={(body) => setEditState((prev) => ({ ...prev, body }))}
            onContentTypeChange={handleContentTypeChange}
            onAuthChange={handleAuthChange}
            onOAuthTokenRequest={handleOAuthTokenRequest}
          />
        </div>

        {!isCompactLayout ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize request and response panels"
            onMouseDown={(event) => {
              event.preventDefault();
              setIsResizingSplit(true);
              updateSplitRatioFromClientX(event.clientX);
            }}
            onMouseEnter={() => setIsSplitHandleHovered(true)}
            onMouseLeave={() => setIsSplitHandleHovered(false)}
            className="relative w-px cursor-col-resize"
            style={{
              backgroundColor: "var(--vscode-sideBar-border, var(--vscode-panel-border))"
            }}
          >
            <div
              className="absolute inset-y-0 -left-[2px] w-[5px] transition-colors"
              style={{
                backgroundColor:
                  isSplitHandleHovered || isResizingSplit
                    ? "var(--vscode-focusBorder)"
                    : "transparent"
              }}
            />
          </div>
        ) : null}

        <div className="min-h-0 min-w-[300px] flex-1 overflow-hidden">
          <ResponsePanel
            editState={editState}
            runResult={runResult}
            runError={runError}
            isRunning={isRunning}
            activeResponseTab={activeResponseTab}
            onChangeResponseTab={setActiveResponseTab}
            aiResponse={aiResponse}
            isAiLoading={isAiLoading}
            onAiResponseConsumed={() => setAiResponse(null)}
            onAskAI={handleAskAi}
          />
        </div>
      </main>
    </div>
  );
}

function isMethodBodyless(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === "GET" || normalized === "HEAD";
}

function contentTypeToMime(contentType: string): string | null {
  switch (contentType) {
    case "json":
      return "application/json";
    case "form-data":
      return "multipart/form-data";
    case "urlencoded":
      return "application/x-www-form-urlencoded";
    case "raw":
      return "text/plain";
    case "binary":
      return "application/octet-stream";
    default:
      return null;
  }
}

function applyAuth(prev: RequestEditState, authType: string, authValue: string): RequestEditState {
  let headers = removeHeader(prev.headers, "Authorization");
  let queryParams = [...prev.queryParams];

  // Remove previous API key placement when switching auth modes.
  if (prev.authType === "apikey") {
    try {
      const previousApiKey = JSON.parse(prev.authValue) as { name?: string; in?: string };
      if (previousApiKey.name) {
        headers = removeHeader(headers, previousApiKey.name);
        queryParams = removeQuery(queryParams, previousApiKey.name);
      }
    } catch {
      // Ignore parse failures for previous values.
    }
  }

  if (authType === "bearer") {
    const token = authValue.trim();
    headers = upsertHeader(headers, "Authorization", token ? `Bearer ${token}` : "Bearer ");
  }

  if (authType === "basic") {
    const parsed = safeParse<{ username?: string; password?: string }>(authValue, {});
    const credentials = `${parsed.username ?? ""}:${parsed.password ?? ""}`;
    const encoded = toBase64(credentials);
    headers = upsertHeader(headers, "Authorization", `Basic ${encoded}`);
  }

  if (authType === "apikey") {
    const parsed = safeParse<{ name?: string; value?: string; in?: "header" | "query" }>(authValue, {
      name: "X-API-Key",
      value: "",
      in: "header"
    });

    const keyName = parsed.name?.trim() || "X-API-Key";
    const keyValue = parsed.value ?? "";
    if (parsed.in === "query") {
      queryParams = upsertQuery(queryParams, keyName, keyValue);
    } else {
      headers = upsertHeader(headers, keyName, keyValue);
    }
  }

  if (authType === "oauth2") {
    const parsed = safeParse<{ token?: string }>(authValue, {});
    if (parsed.token?.trim()) {
      headers = upsertHeader(headers, "Authorization", `Bearer ${parsed.token}`);
    }
  }

  return {
    ...prev,
    authType,
    authValue,
    headers,
    queryParams
  };
}

function toBase64(value: string): string {
  try {
    return btoa(value);
  } catch {
    return value;
  }
}

function safeParse<T>(raw: string, fallback: T): T {
  if (!raw.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function tryExtractAccessToken(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { access_token?: string; token?: string };
    return parsed.access_token ?? parsed.token ?? null;
  } catch {
    return null;
  }
}

function renderSnippet(kind: SnippetKind, request: ExecutableRequest): string {
  if (kind === "curl") {
    const headerLines = Object.entries(request.headers)
      .map(([key, value]) => `  -H '${escapeSingleQuotes(`${key}: ${value}`)}'`)
      .join(" \\\n");
    const body = request.body ? ` \\\n  --data '${escapeSingleQuotes(request.body)}'` : "";
    return [`curl -X ${request.method} '${escapeSingleQuotes(request.url)}'`, headerLines]
      .filter(Boolean)
      .join(" \\\n") + body;
  }

  if (kind === "fetch") {
    return `await fetch(${JSON.stringify(request.url)}, ${JSON.stringify(
      {
        method: request.method,
        headers: request.headers,
        body: request.body
      },
      null,
      2
    )});`;
  }

  if (kind === "axios") {
    return `await axios(${JSON.stringify(
      {
        method: request.method.toLowerCase(),
        url: request.url,
        headers: request.headers,
        data: request.body
      },
      null,
      2
    )});`;
  }

  return [
    "import requests",
    "",
    `response = requests.request(${JSON.stringify(request.method)}, ${JSON.stringify(request.url)},`,
    `    headers=${JSON.stringify(request.headers, null, 2)},`,
    `    data=${JSON.stringify(request.body ?? "")}`,
    ")",
    "print(response.status_code)",
    "print(response.text)"
  ].join("\n");
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function areEditStatesEqual(a: RequestEditState, b: RequestEditState): boolean {
  const normalizeRows = (rows: KeyValueRow[]) =>
    [...rows]
      .map((row) => ({
        key: row.key.trim(),
        value: row.value,
        enabled: row.enabled
      }))
      .sort((left, right) => {
        const leftKey = `${left.key}:${left.value}:${left.enabled ? "1" : "0"}`;
        const rightKey = `${right.key}:${right.value}:${right.enabled ? "1" : "0"}`;
        return leftKey.localeCompare(rightKey);
      });

  const normalizePathParams = (pathParams: Record<string, string>) =>
    Object.entries(pathParams)
      .map(([key, value]) => [key, value] as const)
      .sort(([left], [right]) => left.localeCompare(right));

  return JSON.stringify({
    method: a.method,
    url: a.url,
    pathParams: normalizePathParams(a.pathParams),
    queryParams: normalizeRows(a.queryParams),
    headers: normalizeRows(a.headers),
    body: a.body,
    contentType: a.contentType,
    authType: a.authType,
    authValue: a.authValue
  }) ===
    JSON.stringify({
      method: b.method,
      url: b.url,
      pathParams: normalizePathParams(b.pathParams),
      queryParams: normalizeRows(b.queryParams),
      headers: normalizeRows(b.headers),
      body: b.body,
      contentType: b.contentType,
      authType: b.authType,
      authValue: b.authValue
    });
}
