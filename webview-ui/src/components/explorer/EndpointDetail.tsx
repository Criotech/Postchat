import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExecutionResult } from "../RequestResult";
import type { ParsedEndpoint } from "../../types/spec";
import { ResponseViewer } from "./ResponseViewer";

type EndpointDetailProps = {
  endpoint: ParsedEndpoint | null;
  onAskAI: (endpoint: ParsedEndpoint) => void;
  onRunRequest: (
    endpoint: ParsedEndpoint
  ) => Promise<ExecutionResult | null> | ExecutionResult | null | void;
  liveResult?: ExecutionResult | null;
  onSendToAI?: (prompt: string) => void;
};

type EditableHeader = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

type DetailSection = "params" | "headers" | "body" | "responses";

const METHOD_BADGE_STYLES: Record<ParsedEndpoint["method"], string> = {
  GET: "bg-blue-600/20 text-blue-400 border border-blue-600/30",
  POST: "bg-green-600/20 text-green-400 border border-green-600/30",
  PUT: "bg-orange-600/20 text-orange-400 border border-orange-600/30",
  PATCH: "bg-yellow-600/20 text-yellow-400 border border-yellow-600/30",
  DELETE: "bg-red-600/20 text-red-400 border border-red-600/30",
  HEAD: "bg-gray-600/20 text-gray-400 border border-gray-600/30",
  OPTIONS: "bg-gray-600/20 text-gray-400 border border-gray-600/30"
};

function createRowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function extractPathParamNames(urlTemplate: string): string[] {
  const params = new Set<string>();
  const matcher = /\{([^}]+)\}/g;
  let match = matcher.exec(urlTemplate);

  while (match) {
    const name = match[1]?.trim();
    if (name) {
      params.add(name);
    }
    match = matcher.exec(urlTemplate);
  }

  return Array.from(params);
}

function applyPathParamValues(urlTemplate: string, values: Record<string, string>): string {
  return urlTemplate.replace(/\{([^}]+)\}/g, (_match, rawParam: string) => {
    const key = String(rawParam).trim();
    const replacement = values[key];
    if (replacement === undefined || replacement === "") {
      return `{${key}}`;
    }
    return replacement;
  });
}

function normalizeEditableHeaders(headers: EditableHeader[]): Array<{ key: string; value: string; enabled: boolean }> {
  return headers
    .filter((header) => header.key.trim().length > 0 || header.value.trim().length > 0)
    .map((header) => ({
      key: header.key,
      value: header.value,
      enabled: header.enabled
    }));
}

function getResponseBadge(statusCode: string): string {
  const numeric = Number(statusCode);
  if (Number.isNaN(numeric)) {
    return "bg-gray-600/20 text-gray-400 border border-gray-600/30";
  }

  if (numeric >= 200 && numeric < 300) {
    return "bg-green-600/20 text-green-400 border border-green-600/30";
  }
  if (numeric >= 300 && numeric < 400) {
    return "bg-blue-600/20 text-blue-400 border border-blue-600/30";
  }
  if (numeric >= 400 && numeric < 500) {
    return "bg-orange-600/20 text-orange-400 border border-orange-600/30";
  }
  return "bg-red-600/20 text-red-400 border border-red-600/30";
}

function SectionHeader({
  title,
  isOpen,
  onToggle,
  trailing
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  trailing?: JSX.Element;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-vscode-panelBorder px-3 py-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 text-sm font-semibold text-vscode-editorFg"
      >
        <span
          className={[
            "inline-block text-xs text-vscode-descriptionFg transition-transform duration-150",
            isOpen ? "rotate-90" : "rotate-0"
          ].join(" ")}
        >
          ▶
        </span>
        <span>{title}</span>
      </button>
      {trailing ? <div className="ml-auto">{trailing}</div> : null}
    </div>
  );
}

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value;
}

export function EndpointDetail({
  endpoint,
  onAskAI,
  onRunRequest,
  liveResult,
  onSendToAI
}: EndpointDetailProps): JSX.Element {
  const [urlTemplate, setUrlTemplate] = useState("");
  const [pathParamValues, setPathParamValues] = useState<Record<string, string>>({});
  const [activePathParam, setActivePathParam] = useState<string | null>(null);
  const [headers, setHeaders] = useState<EditableHeader[]>([]);
  const [bodyText, setBodyText] = useState("");
  const [localLiveResult, setLocalLiveResult] = useState<ExecutionResult | null>(null);
  const [sectionsOpen, setSectionsOpen] = useState<Record<DetailSection, boolean>>({
    params: true,
    headers: true,
    body: true,
    responses: true
  });
  const [expandedResponses, setExpandedResponses] = useState<Record<string, boolean>>({});

  const effectiveLiveResult = liveResult ?? localLiveResult;

  useEffect(() => {
    if (!endpoint) {
      setUrlTemplate("");
      setPathParamValues({});
      setActivePathParam(null);
      setHeaders([]);
      setBodyText("");
      setLocalLiveResult(null);
      setExpandedResponses({});
      return;
    }

    const template = endpoint.url;
    const pathParams = extractPathParamNames(template);

    setUrlTemplate(template);
    setPathParamValues(
      pathParams.reduce<Record<string, string>>((acc, name) => {
        acc[name] = "";
        return acc;
      }, {})
    );
    setActivePathParam(pathParams[0] ?? null);
    setHeaders(
      endpoint.headers.map((header) => ({
        id: createRowId(),
        key: header.key,
        value: header.value,
        enabled: header.enabled
      }))
    );
    setBodyText(endpoint.requestBody ?? "");
    setLocalLiveResult(null);
    setExpandedResponses({});
  }, [endpoint]);

  const pathParams = useMemo(() => extractPathParamNames(urlTemplate), [urlTemplate]);

  const resolvedUrl = useMemo(() => {
    return applyPathParamValues(urlTemplate, pathParamValues);
  }, [pathParamValues, urlTemplate]);

  const urlModified = endpoint ? resolvedUrl !== endpoint.url || urlTemplate !== endpoint.url : false;

  const normalizedOriginalHeaders = useMemo(() => {
    if (!endpoint) {
      return [];
    }

    return endpoint.headers.map((header) => ({
      key: header.key,
      value: header.value,
      enabled: header.enabled
    }));
  }, [endpoint]);

  const normalizedEditedHeaders = useMemo(() => normalizeEditableHeaders(headers), [headers]);

  const headersModified = useMemo(() => {
    if (!endpoint) {
      return false;
    }

    return JSON.stringify(normalizedEditedHeaders) !== JSON.stringify(normalizedOriginalHeaders);
  }, [endpoint, normalizedEditedHeaders, normalizedOriginalHeaders]);

  const bodyModified = endpoint ? bodyText !== (endpoint.requestBody ?? "") : false;

  const effectiveEndpoint = useMemo<ParsedEndpoint | null>(() => {
    if (!endpoint) {
      return null;
    }

    return {
      ...endpoint,
      url: resolvedUrl,
      headers: normalizedEditedHeaders.map((header) => ({
        key: header.key,
        value: header.value,
        enabled: header.enabled
      })),
      requestBody: bodyText
    };
  }, [bodyText, endpoint, normalizedEditedHeaders, resolvedUrl]);

  const toggleSection = useCallback((section: DetailSection) => {
    setSectionsOpen((prev) => ({
      ...prev,
      [section]: !prev[section]
    }));
  }, []);

  const handleRun = useCallback(async () => {
    if (!effectiveEndpoint) {
      return;
    }

    const maybeResult = onRunRequest(effectiveEndpoint);

    if (isPromiseLike<ExecutionResult | null>(maybeResult)) {
      const result = await maybeResult;
      if (result) {
        setLocalLiveResult(result);
      }
      return;
    }

    if (maybeResult) {
      setLocalLiveResult(maybeResult);
    }
  }, [effectiveEndpoint, onRunRequest]);

  const handleAskAI = useCallback(() => {
    if (!effectiveEndpoint) {
      return;
    }

    onAskAI(effectiveEndpoint);
  }, [effectiveEndpoint, onAskAI]);

  if (!endpoint) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-vscode-descriptionFg">
        Select an endpoint to view details
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="border-b border-vscode-panelBorder px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={["rounded px-2 py-0.5 text-xs font-semibold", METHOD_BADGE_STYLES[endpoint.method]].join(" ")}>
            {endpoint.method}
          </span>
          <h2 className="min-w-0 flex-1 truncate text-base font-bold text-vscode-editorFg">{endpoint.name}</h2>
          {endpoint.requiresAuth ? (
            <span
              className="rounded border border-vscode-panelBorder bg-vscode-inputBg px-1.5 py-0.5 text-xs text-vscode-descriptionFg"
              title={endpoint.authType ? `Auth: ${endpoint.authType}` : "Auth required"}
            >
              🔑
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void handleRun()}
            className="rounded bg-vscode-buttonBg px-2.5 py-1 text-xs font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover"
          >
            ▶ Run Request
          </button>
          <button
            type="button"
            onClick={handleAskAI}
            className="rounded bg-vscode-buttonSecondaryBg px-2.5 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
          >
            💬 Ask AI
          </button>
        </div>

        <div className="mt-3 rounded border border-vscode-panelBorder bg-vscode-inputBg px-2 py-2">
          <input
            value={resolvedUrl}
            onChange={(event) => {
              const nextTemplate = event.target.value;
              const nextParams = extractPathParamNames(nextTemplate);
              setUrlTemplate(nextTemplate);
              setPathParamValues((prev) => {
                const next: Record<string, string> = {};
                for (const param of nextParams) {
                  next[param] = prev[param] ?? "";
                }
                return next;
              });
              if (nextParams.length > 0 && (!activePathParam || !nextParams.includes(activePathParam))) {
                setActivePathParam(nextParams[0]);
              }
              if (nextParams.length === 0) {
                setActivePathParam(null);
              }
            }}
            className="w-full border-none bg-transparent font-mono text-xs text-vscode-inputFg outline-none"
          />

          {pathParams.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {pathParams.map((param) => (
                <button
                  key={param}
                  type="button"
                  onClick={() => setActivePathParam(param)}
                  className={[
                    "rounded px-1.5 py-0.5 font-mono text-[11px]",
                    activePathParam === param
                      ? "bg-vscode-buttonBg text-vscode-buttonFg"
                      : "bg-vscode-listHover text-vscode-editorFg"
                  ].join(" ")}
                >
                  {`{${param}}`}
                </button>
              ))}
            </div>
          ) : null}

          {activePathParam ? (
            <div className="mt-2 flex items-center gap-2">
              <label className="text-[11px] text-vscode-descriptionFg">{`{${activePathParam}}`}</label>
              <input
                value={pathParamValues[activePathParam] ?? ""}
                onChange={(event) =>
                  setPathParamValues((prev) => ({
                    ...prev,
                    [activePathParam]: event.target.value
                  }))
                }
                placeholder="Value"
                className="min-w-0 flex-1 rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs text-vscode-inputFg"
              />
            </div>
          ) : null}

          {urlModified ? (
            <button
              type="button"
              onClick={() => {
                setUrlTemplate(endpoint.url);
                const names = extractPathParamNames(endpoint.url);
                setPathParamValues(
                  names.reduce<Record<string, string>>((acc, name) => {
                    acc[name] = "";
                    return acc;
                  }, {})
                );
                setActivePathParam(names[0] ?? null);
              }}
              className="mt-2 text-xs text-vscode-linkFg underline"
            >
              Reset URL
            </button>
          ) : null}
        </div>
      </div>

      {endpoint.parameters.length > 0 ? (
        <section className="border-b border-vscode-panelBorder">
          <SectionHeader
            title="Parameters"
            isOpen={sectionsOpen.params}
            onToggle={() => toggleSection("params")}
          />
          {sectionsOpen.params ? (
            <div className="overflow-x-auto p-3">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-vscode-panelBorder text-vscode-descriptionFg">
                    <th className="px-2 py-1 font-medium">Name</th>
                    <th className="px-2 py-1 font-medium">In</th>
                    <th className="px-2 py-1 font-medium">Type</th>
                    <th className="px-2 py-1 font-medium">Required</th>
                    <th className="px-2 py-1 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoint.parameters.map((param) => (
                    <tr key={`${param.location}:${param.name}`} className="border-b border-vscode-panelBorder/40">
                      <td className="px-2 py-1 text-vscode-editorFg">
                        <span className={param.required ? "font-semibold" : ""}>{param.name}</span>
                        {param.required ? (
                          <span className="ml-1 rounded bg-orange-600/20 px-1 text-[10px] text-orange-300">*</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1 text-vscode-descriptionFg">{param.location}</td>
                      <td className="px-2 py-1 text-vscode-descriptionFg">{param.type}</td>
                      <td className="px-2 py-1 text-vscode-descriptionFg">{param.required ? "Yes" : "No"}</td>
                      <td className="px-2 py-1 text-vscode-descriptionFg">{param.description || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {endpoint.headers.length > 0 ? (
        <section className="border-b border-vscode-panelBorder">
          <SectionHeader
            title="Headers"
            isOpen={sectionsOpen.headers}
            onToggle={() => toggleSection("headers")}
            trailing={
              headersModified ? (
                <button
                  type="button"
                  onClick={() =>
                    setHeaders(
                      endpoint.headers.map((header) => ({
                        id: createRowId(),
                        key: header.key,
                        value: header.value,
                        enabled: header.enabled
                      }))
                    )
                  }
                  className="text-xs text-vscode-linkFg underline"
                >
                  Reset Headers
                </button>
              ) : undefined
            }
          />

          {sectionsOpen.headers ? (
            <div className="p-3">
              <div className="space-y-2">
                {headers.map((header) => (
                  <div key={header.id} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                    <input
                      value={header.key}
                      onChange={(event) =>
                        setHeaders((prev) =>
                          prev.map((row) =>
                            row.id === header.id ? { ...row, key: event.target.value } : row
                          )
                        )
                      }
                      placeholder="Header key"
                      className="rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs text-vscode-inputFg"
                    />
                    <input
                      value={header.value}
                      onChange={(event) =>
                        setHeaders((prev) =>
                          prev.map((row) =>
                            row.id === header.id ? { ...row, value: event.target.value } : row
                          )
                        )
                      }
                      placeholder="Header value"
                      className="rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs text-vscode-inputFg"
                    />
                    <label className="flex items-center gap-1 text-xs text-vscode-descriptionFg">
                      <input
                        type="checkbox"
                        checked={header.enabled}
                        onChange={(event) =>
                          setHeaders((prev) =>
                            prev.map((row) =>
                              row.id === header.id ? { ...row, enabled: event.target.checked } : row
                            )
                          )
                        }
                      />
                      enabled
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setHeaders((prev) => prev.filter((row) => row.id !== header.id))
                      }
                      className="rounded px-1 py-0.5 text-xs text-vscode-descriptionFg hover:bg-vscode-listHover"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() =>
                  setHeaders((prev) => [
                    ...prev,
                    {
                      id: createRowId(),
                      key: "",
                      value: "",
                      enabled: true
                    }
                  ])
                }
                className="mt-3 rounded bg-vscode-buttonSecondaryBg px-2 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
              >
                Add Header
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {endpoint.requestBody !== undefined ? (
        <section className="border-b border-vscode-panelBorder">
          <SectionHeader
            title="Request Body"
            isOpen={sectionsOpen.body}
            onToggle={() => toggleSection("body")}
            trailing={
              bodyModified ? (
                <button
                  type="button"
                  onClick={() => setBodyText(endpoint.requestBody ?? "")}
                  className="text-xs text-vscode-linkFg underline"
                >
                  Reset Body
                </button>
              ) : undefined
            }
          />

          {sectionsOpen.body ? (
            <div className="p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded bg-vscode-badgeBg px-1.5 py-0.5 text-[11px] text-vscode-badgeFg">
                  {endpoint.requestContentType || "text/plain"}
                </span>
                {endpoint.requestContentType?.toLowerCase().includes("application/json") ? (
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        const parsed = JSON.parse(bodyText);
                        setBodyText(JSON.stringify(parsed, null, 2));
                      } catch {
                        // Keep current body if invalid JSON.
                      }
                    }}
                    className="rounded bg-vscode-buttonSecondaryBg px-2 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
                  >
                    Format JSON
                  </button>
                ) : null}
              </div>

              <textarea
                value={bodyText}
                onChange={(event) => setBodyText(event.target.value)}
                className="h-44 w-full rounded border border-vscode-panelBorder bg-vscode-inputBg px-2 py-1 font-mono text-xs text-vscode-inputFg"
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="border-b border-vscode-panelBorder">
        <SectionHeader
          title="Responses"
          isOpen={sectionsOpen.responses}
          onToggle={() => toggleSection("responses")}
        />

        {sectionsOpen.responses ? (
          <div className="space-y-3 p-3">
            {effectiveLiveResult ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-vscode-descriptionFg">
                  Live Response
                </h3>
                <ResponseViewer
                  result={effectiveLiveResult}
                  requestName={endpoint.name}
                  onSendToAI={onSendToAI}
                />
              </div>
            ) : null}

            {endpoint.responses.length === 0 ? (
              <p className="text-sm text-vscode-descriptionFg">No response examples provided.</p>
            ) : null}

            {endpoint.responses.map((response) => {
              const key = `${response.statusCode}-${response.description}`;
              const hasContent = Boolean(response.bodySchema || response.example);
              const isOpen = expandedResponses[key] ?? false;

              return (
                <article key={key} className="rounded border border-vscode-panelBorder p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={["rounded px-2 py-0.5 text-xs font-semibold", getResponseBadge(response.statusCode)].join(" ")}>
                      {response.statusCode}
                    </span>
                    <p className="text-sm text-vscode-editorFg">{response.description || "(no description)"}</p>
                    {hasContent ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedResponses((prev) => ({
                            ...prev,
                            [key]: !isOpen
                          }))
                        }
                        className="ml-auto text-xs text-vscode-linkFg underline"
                      >
                        {isOpen ? "Hide details" : "Show details"}
                      </button>
                    ) : null}
                  </div>

                  {isOpen ? (
                    <div className="mt-2 space-y-2 rounded border border-vscode-panelBorder bg-vscode-inputBg/50 p-2">
                      {response.bodySchema ? (
                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase text-vscode-descriptionFg">Schema</p>
                          <pre className="m-0 whitespace-pre-wrap font-mono text-xs text-vscode-editorFg">
                            {response.bodySchema}
                          </pre>
                        </div>
                      ) : null}

                      {response.example ? (
                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase text-vscode-descriptionFg">Example</p>
                          <pre className="m-0 whitespace-pre-wrap font-mono text-xs text-vscode-editorFg">
                            {response.example}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}
