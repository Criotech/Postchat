import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, Plus } from "lucide-react";
import type { ParsedEndpoint } from "../../types/spec";
import { vscode } from "../../vscode";
import type { KeyValueRow, RequestEditState } from "../types";

export type PanelTab = "params" | "headers" | "body" | "auth" | "description";

type RequestPanelProps = {
  endpoint: ParsedEndpoint | null;
  editState: RequestEditState;
  activeTab?: PanelTab;
  onActiveTabChange?: (tab: PanelTab) => void;
  onPathParamChange: (key: string, value: string) => void;
  onQueryParamsChange: (rows: KeyValueRow[]) => void;
  onHeadersChange: (rows: KeyValueRow[]) => void;
  onBodyChange: (body: string) => void;
  onContentTypeChange: (contentType: string) => void;
  onAuthChange: (authType: string, authValue: string) => void;
  onOAuthTokenRequest: (tokenUrl: string, clientId: string, clientSecret: string) => void;
};

const COMMON_HEADERS = [
  "Content-Type",
  "Accept",
  "Authorization",
  "X-API-Key",
  "X-Request-ID",
  "User-Agent",
  "Cache-Control"
] as const;

type ApiKeyAuthConfig = {
  name: string;
  value: string;
  in: "header" | "query";
};

type BasicAuthConfig = {
  username: string;
  password: string;
};

type OAuth2Config = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  token?: string;
};

export function RequestPanel({
  endpoint,
  editState,
  activeTab: activeTabProp,
  onActiveTabChange,
  onPathParamChange,
  onQueryParamsChange,
  onHeadersChange,
  onBodyChange,
  onContentTypeChange,
  onAuthChange,
  onOAuthTokenRequest
}: RequestPanelProps): JSX.Element {
  const [internalActiveTab, setInternalActiveTab] = useState<PanelTab>("params");
  const [isQueryBulkEdit, setIsQueryBulkEdit] = useState(false);
  const [queryBulkText, setQueryBulkText] = useState("");
  const [bodyValidation, setBodyValidation] = useState<string | null>(null);
  const [isFormRaw, setIsFormRaw] = useState(false);
  const [formRows, setFormRows] = useState<KeyValueRow[]>([]);
  const activeTab = activeTabProp ?? internalActiveTab;
  const setActiveTab = onActiveTabChange ?? setInternalActiveTab;

  const pathEntries = useMemo(
    () => Object.entries(editState.pathParams),
    [editState.pathParams]
  );

  const paramCount = pathEntries.length + editState.queryParams.filter((row) => row.enabled && row.key.trim()).length;
  const headerCount = editState.headers.filter((row) => row.enabled && row.key.trim()).length;
  const bodyCount = editState.body.trim() ? 1 : 0;
  const authCount = editState.authType !== "none" ? 1 : 0;
  const descriptionCount = endpoint?.description?.trim() ? 1 : 0;

  useEffect(() => {
    const raw = editState.queryParams
      .filter((row) => row.key.trim())
      .map((row) => `${encodeURIComponent(row.key)}=${encodeURIComponent(row.value)}`)
      .join("&");
    setQueryBulkText(raw);
  }, [editState.queryParams]);

  useEffect(() => {
    if (editState.contentType !== "form-data" && editState.contentType !== "urlencoded") {
      return;
    }

    const source = editState.body.trim();
    if (!source) {
      setFormRows([]);
      return;
    }

    const params = new URLSearchParams(source);
    const nextRows: KeyValueRow[] = [];
    params.forEach((value, key) => {
      nextRows.push({ key, value, enabled: true });
    });
    setFormRows(nextRows);
  }, [editState.body, editState.contentType]);

  const applyQueryBulkText = (raw: string) => {
    const params = new URLSearchParams(raw);
    const rows: KeyValueRow[] = [];
    params.forEach((value, key) => {
      rows.push({ key, value, enabled: true });
    });
    onQueryParamsChange(rows);
  };

  const updateQueryRow = (index: number, updates: Partial<KeyValueRow>) => {
    const next = [...editState.queryParams];
    next[index] = { ...next[index], ...updates };
    onQueryParamsChange(next);
  };

  const updateHeaderRow = (index: number, updates: Partial<KeyValueRow>) => {
    const next = [...editState.headers];
    next[index] = { ...next[index], ...updates };
    onHeadersChange(next);
  };

  const addHeaderPreset = (preset: "json" | "auth") => {
    if (preset === "json") {
      const next = upsertOrAppendHeader(editState.headers, "Content-Type", "application/json");
      onHeadersChange(upsertOrAppendHeader(next, "Accept", "application/json"));
      onContentTypeChange("json");
      return;
    }

    onHeadersChange(upsertOrAppendHeader(editState.headers, "Authorization", "Bearer "));
  };

  const updateFormRows = (rows: KeyValueRow[]) => {
    setFormRows(rows);
    const body = rows
      .filter((row) => row.enabled && row.key.trim())
      .map((row) => `${encodeURIComponent(row.key)}=${encodeURIComponent(row.value)}`)
      .join("&");
    onBodyChange(body);
  };

  const canHaveBody = !["GET", "HEAD"].includes(editState.method.toUpperCase());

  const apiKeyConfig = parseApiKeyConfig(editState.authValue);
  const basicConfig = parseBasicConfig(editState.authValue);
  const oauthConfig = parseOAuth2Config(editState.authValue);

  return (
    <section className="flex h-full min-h-0 flex-col border-r border-vscode-panelBorder bg-vscode-editorBg">
      <nav className="flex border-b border-vscode-panelBorder px-2 pt-2 text-xs">
        <PanelTabButton label="Params" count={paramCount} active={activeTab === "params"} onClick={() => setActiveTab("params")} />
        <PanelTabButton label="Headers" count={headerCount} active={activeTab === "headers"} onClick={() => setActiveTab("headers")} />
        <PanelTabButton label="Body" count={bodyCount} active={activeTab === "body"} onClick={() => setActiveTab("body")} />
        <PanelTabButton label="Auth" count={authCount} active={activeTab === "auth"} onClick={() => setActiveTab("auth")} />
        <PanelTabButton
          label="Description"
          count={descriptionCount}
          active={activeTab === "description"}
          onClick={() => setActiveTab("description")}
        />
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === "params" ? (
          <div className="space-y-4">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-vscode-muted">Path Parameters</h3>
              {pathEntries.length === 0 ? (
                <p className="rounded border border-vscode-panelBorder bg-vscode-card p-2 text-xs text-vscode-muted">
                  No path parameters detected.
                </p>
              ) : (
                <div className="space-y-2">
                  {pathEntries.map(([key, value]) => (
                    <div key={key} className="grid grid-cols-[minmax(120px,180px)_1fr_auto] items-center gap-2">
                      <div className="rounded border border-vscode-panelBorder bg-vscode-card px-2 py-1 text-xs font-medium">
                        {key}
                      </div>
                      <input
                        value={value}
                        onChange={(event) => onPathParamChange(key, event.target.value)}
                        className="rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1.5 text-xs focus:border-vscode-focusBorder focus:outline-none"
                      />
                      <span className="rounded bg-vscode-badgeBg px-1.5 py-0.5 text-[10px] text-vscode-badgeFg">Required</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-vscode-muted">Query Parameters</h3>
                <button
                  type="button"
                  onClick={() => setIsQueryBulkEdit((prev) => !prev)}
                  className="rounded border border-vscode-panelBorder px-2 py-1 text-[11px] hover:bg-vscode-listHover"
                >
                  {isQueryBulkEdit ? "Table view" : "Bulk edit"}
                </button>
              </div>

              {isQueryBulkEdit ? (
                <textarea
                  value={queryBulkText}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setQueryBulkText(nextValue);
                    applyQueryBulkText(nextValue);
                  }}
                  className="h-28 w-full rounded border border-vscode-inputBorder bg-vscode-inputBg p-2 font-mono text-xs focus:border-vscode-focusBorder focus:outline-none"
                  placeholder="page=1&limit=20"
                />
              ) : (
                <div className="space-y-2">
                  {editState.queryParams.map((row, index) => (
                    <KeyValueRowEditor
                      key={`query-${index}`}
                      row={row}
                      onChange={(updates) => updateQueryRow(index, updates)}
                      onDelete={() => {
                        const next = editState.queryParams.filter((_candidate, rowIndex) => rowIndex !== index);
                        onQueryParamsChange(next);
                      }}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => onQueryParamsChange([...editState.queryParams, { key: "", value: "", enabled: true }])}
                    className="inline-flex items-center gap-1 rounded border border-vscode-panelBorder px-2 py-1 text-xs hover:bg-vscode-listHover"
                  >
                    <Plus size={12} />
                    Add param
                  </button>
                </div>
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "headers" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => addHeaderPreset("json")}
                className="rounded border border-vscode-panelBorder px-2 py-1 text-xs hover:bg-vscode-listHover"
              >
                Add JSON headers
              </button>
              <button
                type="button"
                onClick={() => addHeaderPreset("auth")}
                className="rounded border border-vscode-panelBorder px-2 py-1 text-xs hover:bg-vscode-listHover"
              >
                Add Auth header
              </button>
            </div>

            {editState.headers.map((row, index) => (
              <KeyValueRowEditor
                key={`header-${index}`}
                row={row}
                datalistId="postchat-header-suggestions"
                onChange={(updates) => {
                  const next = [...editState.headers];
                  next[index] = { ...next[index], ...updates };
                  onHeadersChange(next);
                }}
                onDelete={() => {
                  const next = editState.headers.filter((_candidate, rowIndex) => rowIndex !== index);
                  onHeadersChange(next);
                }}
              />
            ))}

            <datalist id="postchat-header-suggestions">
              {COMMON_HEADERS.map((header) => (
                <option key={header} value={header} />
              ))}
            </datalist>

            <button
              type="button"
              onClick={() => onHeadersChange([...editState.headers, { key: "", value: "", enabled: true }])}
              className="inline-flex items-center gap-1 rounded border border-vscode-panelBorder px-2 py-1 text-xs hover:bg-vscode-listHover"
            >
              <Plus size={12} />
              Add header
            </button>
          </div>
        ) : null}

        {activeTab === "body" ? (
          <div className="space-y-3">
            {!canHaveBody ? (
              <p className="rounded border border-vscode-panelBorder bg-vscode-card p-2 text-xs text-vscode-muted">
                {editState.method.toUpperCase()} requests do not have a body.
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-vscode-muted">Content type</label>
                  <select
                    value={editState.contentType}
                    onChange={(event) => onContentTypeChange(event.target.value)}
                    className="rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs focus:border-vscode-focusBorder focus:outline-none"
                  >
                    <option value="none">None</option>
                    <option value="json">JSON</option>
                    <option value="form-data">Form Data</option>
                    <option value="urlencoded">URL Encoded</option>
                    <option value="raw">Raw Text</option>
                    <option value="binary">Binary</option>
                  </select>
                </div>

                {editState.contentType === "json" ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            const parsed = JSON.parse(editState.body || "{}");
                            onBodyChange(JSON.stringify(parsed, null, 2));
                            setBodyValidation("JSON formatted.");
                          } catch {
                            setBodyValidation("Unable to format invalid JSON.");
                          }
                        }}
                        className="rounded border border-vscode-panelBorder px-2 py-1 text-xs hover:bg-vscode-listHover"
                      >
                        Format JSON
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            JSON.parse(editState.body || "{}");
                            setBodyValidation("Valid JSON ✓");
                          } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            setBodyValidation(`Invalid JSON: ${message}`);
                          }
                        }}
                        className="rounded border border-vscode-panelBorder px-2 py-1 text-xs hover:bg-vscode-listHover"
                      >
                        Validate
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const generated = generateExampleFromSchema(editState.body);
                          if (generated) {
                            onBodyChange(JSON.stringify(generated, null, 2));
                            setBodyValidation("Generated example from schema.");
                          } else {
                            setBodyValidation("Could not generate example from schema.");
                          }
                        }}
                        className="rounded border border-vscode-panelBorder px-2 py-1 text-xs hover:bg-vscode-listHover"
                      >
                        Generate Example
                      </button>
                    </div>

                    <div className="flex overflow-hidden rounded border border-vscode-inputBorder bg-vscode-inputBg">
                      <pre className="m-0 min-w-10 select-none border-r border-vscode-panelBorder px-2 py-2 text-right font-mono text-[11px] text-vscode-muted">
                        {buildLineNumbers(editState.body)}
                      </pre>
                      <textarea
                        value={editState.body}
                        onChange={(event) => onBodyChange(event.target.value)}
                        className="h-72 flex-1 resize-none bg-transparent p-2 font-mono text-xs focus:outline-none"
                      />
                    </div>
                  </div>
                ) : null}

                {(editState.contentType === "form-data" || editState.contentType === "urlencoded") && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setIsFormRaw((prev) => !prev)}
                      className="rounded border border-vscode-panelBorder px-2 py-1 text-xs hover:bg-vscode-listHover"
                    >
                      {isFormRaw ? "Key/value editor" : "Raw editor"}
                    </button>

                    {isFormRaw ? (
                      <textarea
                        value={editState.body}
                        onChange={(event) => onBodyChange(event.target.value)}
                        className="h-40 w-full rounded border border-vscode-inputBorder bg-vscode-inputBg p-2 font-mono text-xs focus:border-vscode-focusBorder focus:outline-none"
                        placeholder="key=value&key2=value2"
                      />
                    ) : (
                      <div className="space-y-2">
                        {formRows.map((row, index) => (
                          <KeyValueRowEditor
                            key={`form-${index}`}
                            row={row}
                            onChange={(updates) => {
                              const next = [...formRows];
                              next[index] = { ...next[index], ...updates };
                              updateFormRows(next);
                            }}
                            onDelete={() => updateFormRows(formRows.filter((_row, rowIndex) => rowIndex !== index))}
                          />
                        ))}
                        <button
                          type="button"
                          onClick={() => updateFormRows([...formRows, { key: "", value: "", enabled: true }])}
                          className="inline-flex items-center gap-1 rounded border border-vscode-panelBorder px-2 py-1 text-xs hover:bg-vscode-listHover"
                        >
                          <Plus size={12} />
                          Add field
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {editState.contentType === "raw" || editState.contentType === "binary" || editState.contentType === "none" ? (
                  <textarea
                    value={editState.body}
                    onChange={(event) => onBodyChange(event.target.value)}
                    className="h-56 w-full rounded border border-vscode-inputBorder bg-vscode-inputBg p-2 font-mono text-xs focus:border-vscode-focusBorder focus:outline-none"
                    placeholder={editState.contentType === "binary" ? "Binary payload placeholder" : "Request body"}
                  />
                ) : null}

                {bodyValidation ? (
                  <p className="rounded border border-vscode-panelBorder bg-vscode-card px-2 py-1 text-xs text-vscode-muted">
                    {bodyValidation}
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {activeTab === "auth" ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-vscode-muted">Auth type</label>
              <select
                value={editState.authType}
                onChange={(event) => {
                  const authType = event.target.value;
                  if (authType === "none") {
                    onAuthChange("none", "");
                    return;
                  }
                  if (authType === "bearer") {
                    onAuthChange("bearer", "");
                    return;
                  }
                  if (authType === "apikey") {
                    onAuthChange("apikey", JSON.stringify({ name: "X-API-Key", value: "", in: "header" }));
                    return;
                  }
                  if (authType === "basic") {
                    onAuthChange("basic", JSON.stringify({ username: "", password: "" }));
                    return;
                  }
                  onAuthChange(
                    "oauth2",
                    JSON.stringify({ tokenUrl: "", clientId: "", clientSecret: "", token: "" })
                  );
                }}
                className="rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs focus:border-vscode-focusBorder focus:outline-none"
              >
                <option value="none">None</option>
                <option value="bearer">Bearer Token</option>
                <option value="apikey">API Key</option>
                <option value="basic">Basic Auth</option>
                <option value="oauth2">OAuth 2.0</option>
              </select>
            </div>

            {editState.authType === "none" ? (
              <p className="rounded border border-vscode-panelBorder bg-vscode-card p-2 text-xs text-vscode-muted">
                No authentication set.
              </p>
            ) : null}

            {editState.authType === "bearer" ? (
              <div className="space-y-1">
                <label className="text-xs text-vscode-muted">Token</label>
                <input
                  value={editState.authValue}
                  onChange={(event) => onAuthChange("bearer", event.target.value)}
                  className="w-full rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs focus:border-vscode-focusBorder focus:outline-none"
                  placeholder="Paste bearer token"
                />
              </div>
            ) : null}

            {editState.authType === "apikey" ? (
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-xs text-vscode-muted">Key name</label>
                  <input
                    value={apiKeyConfig.name}
                    onChange={(event) =>
                      onAuthChange(
                        "apikey",
                        JSON.stringify({ ...apiKeyConfig, name: event.target.value || "X-API-Key" })
                      )
                    }
                    className="w-full rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs focus:border-vscode-focusBorder focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-vscode-muted">Key value</label>
                  <input
                    value={apiKeyConfig.value}
                    onChange={(event) =>
                      onAuthChange("apikey", JSON.stringify({ ...apiKeyConfig, value: event.target.value }))
                    }
                    className="w-full rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs focus:border-vscode-focusBorder focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-vscode-muted">Add to</label>
                  <select
                    value={apiKeyConfig.in}
                    onChange={(event) =>
                      onAuthChange(
                        "apikey",
                        JSON.stringify({ ...apiKeyConfig, in: event.target.value as "header" | "query" })
                      )
                    }
                    className="rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs focus:border-vscode-focusBorder focus:outline-none"
                  >
                    <option value="header">Header</option>
                    <option value="query">Query Params</option>
                  </select>
                </div>
              </div>
            ) : null}

            {editState.authType === "basic" ? (
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-xs text-vscode-muted">Username</label>
                  <input
                    value={basicConfig.username}
                    onChange={(event) =>
                      onAuthChange("basic", JSON.stringify({ ...basicConfig, username: event.target.value }))
                    }
                    className="w-full rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs focus:border-vscode-focusBorder focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-vscode-muted">Password</label>
                  <input
                    type="password"
                    value={basicConfig.password}
                    onChange={(event) =>
                      onAuthChange("basic", JSON.stringify({ ...basicConfig, password: event.target.value }))
                    }
                    className="w-full rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs focus:border-vscode-focusBorder focus:outline-none"
                  />
                </div>
              </div>
            ) : null}

            {editState.authType === "oauth2" ? (
              <div className="space-y-2">
                <LabeledInput
                  label="Token URL"
                  value={oauthConfig.tokenUrl}
                  onChange={(value) =>
                    onAuthChange("oauth2", JSON.stringify({ ...oauthConfig, tokenUrl: value }))
                  }
                />
                <LabeledInput
                  label="Client ID"
                  value={oauthConfig.clientId}
                  onChange={(value) =>
                    onAuthChange("oauth2", JSON.stringify({ ...oauthConfig, clientId: value }))
                  }
                />
                <LabeledInput
                  label="Client Secret"
                  value={oauthConfig.clientSecret}
                  onChange={(value) =>
                    onAuthChange("oauth2", JSON.stringify({ ...oauthConfig, clientSecret: value }))
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    onOAuthTokenRequest(oauthConfig.tokenUrl, oauthConfig.clientId, oauthConfig.clientSecret)
                  }
                  className="rounded border border-vscode-panelBorder px-2 py-1 text-xs hover:bg-vscode-listHover"
                >
                  Get Token
                </button>
                {oauthConfig.token ? (
                  <p className="rounded border border-vscode-panelBorder bg-vscode-card px-2 py-1 text-xs text-vscode-muted">
                    Token loaded.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === "description" ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto rounded border border-vscode-panelBorder bg-vscode-card p-3 text-sm">
              {endpoint?.description?.trim() ? (
                <div className="prose prose-sm max-w-none text-vscode-editorFg">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{endpoint.description}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-xs text-vscode-muted">No description.</p>
              )}
            </div>
            {endpoint ? (
              <button
                type="button"
                onClick={() => {
                  vscode.postMessage({ command: "highlightInExplorer", endpointId: endpoint.id });
                }}
                className="mt-2 inline-flex items-center gap-1 self-start text-xs text-vscode-linkFg hover:underline"
              >
                <ExternalLink size={12} />
                View in Explorer
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PanelTabButton({
  label,
  count,
  active,
  onClick
}: {
  label: string;
  count: number;
  active: boolean;
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
      {count > 0 ? (
        <span className="rounded bg-vscode-badgeBg px-1 py-0.5 text-[10px] text-vscode-badgeFg">{count}</span>
      ) : null}
    </button>
  );
}

function KeyValueRowEditor({
  row,
  onChange,
  onDelete,
  datalistId
}: {
  row: KeyValueRow;
  onChange: (updates: Partial<KeyValueRow>) => void;
  onDelete: () => void;
  datalistId?: string;
}): JSX.Element {
  return (
    <div className="grid grid-cols-[20px_1fr_1fr_auto] items-center gap-2">
      <input
        type="checkbox"
        checked={row.enabled}
        onChange={(event) => onChange({ enabled: event.target.checked })}
      />
      <input
        value={row.key}
        list={datalistId}
        onChange={(event) => onChange({ key: event.target.value })}
        placeholder="Key"
        className="rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs focus:border-vscode-focusBorder focus:outline-none"
      />
      <input
        value={row.value}
        onChange={(event) => onChange({ value: event.target.value })}
        placeholder="Value"
        className="rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs focus:border-vscode-focusBorder focus:outline-none"
      />
      <button
        type="button"
        onClick={onDelete}
        className="rounded border border-vscode-panelBorder px-1.5 py-1 text-[11px] hover:bg-vscode-listHover"
      >
        Remove
      </button>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <label className="text-xs text-vscode-muted">{label}</label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs focus:border-vscode-focusBorder focus:outline-none"
      />
    </div>
  );
}

function upsertOrAppendHeader(rows: KeyValueRow[], key: string, value: string): KeyValueRow[] {
  const next = [...rows];
  const existing = next.find((row) => row.key.toLowerCase() === key.toLowerCase());
  if (existing) {
    existing.value = value;
    existing.enabled = true;
    return next;
  }

  next.push({ key, value, enabled: true });
  return next;
}

function parseApiKeyConfig(raw: string): ApiKeyAuthConfig {
  if (!raw) {
    return { name: "X-API-Key", value: "", in: "header" };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ApiKeyAuthConfig>;
    return {
      name: parsed.name || "X-API-Key",
      value: parsed.value || "",
      in: parsed.in === "query" ? "query" : "header"
    };
  } catch {
    return { name: "X-API-Key", value: "", in: "header" };
  }
}

function parseBasicConfig(raw: string): BasicAuthConfig {
  if (!raw) {
    return { username: "", password: "" };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<BasicAuthConfig>;
    return {
      username: parsed.username || "",
      password: parsed.password || ""
    };
  } catch {
    return { username: "", password: "" };
  }
}

function parseOAuth2Config(raw: string): OAuth2Config {
  if (!raw) {
    return { tokenUrl: "", clientId: "", clientSecret: "", token: "" };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<OAuth2Config>;
    return {
      tokenUrl: parsed.tokenUrl || "",
      clientId: parsed.clientId || "",
      clientSecret: parsed.clientSecret || "",
      token: parsed.token || ""
    };
  } catch {
    return { tokenUrl: "", clientId: "", clientSecret: "", token: "" };
  }
}

function buildLineNumbers(content: string): string {
  const lines = Math.max(1, content.split("\n").length);
  return Array.from({ length: lines }, (_item, index) => `${index + 1}`).join("\n");
}

function generateExampleFromSchema(schemaRaw: string): Record<string, unknown> | null {
  if (!schemaRaw.trim()) {
    return null;
  }

  try {
    const schema = JSON.parse(schemaRaw) as {
      properties?: Record<string, { type?: string; example?: unknown }>;
    };

    if (!schema || typeof schema !== "object" || !schema.properties) {
      return null;
    }

    const example: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(schema.properties)) {
      if (property.example !== undefined) {
        example[key] = property.example;
        continue;
      }

      switch (property.type) {
        case "string":
          example[key] = "string";
          break;
        case "number":
        case "integer":
          example[key] = 0;
          break;
        case "boolean":
          example[key] = false;
          break;
        case "array":
          example[key] = [];
          break;
        case "object":
          example[key] = {};
          break;
        default:
          example[key] = null;
          break;
      }
    }

    return example;
  } catch {
    return null;
  }
}
