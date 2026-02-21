import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlignJustify,
  Braces,
  Check,
  ExternalLink,
  Key,
  Lock,
  Plus,
  Shield,
  Table2,
  Trash2,
  X
} from "lucide-react";
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
    <section className="flex h-full min-h-0 flex-col border-r border-vscode-panelBorder">
      {/* Tab navigation */}
      <nav className="flex border-b border-vscode-panelBorder text-[12px]">
        <PanelTabButton label="Params" count={paramCount} active={activeTab === "params"} onClick={() => setActiveTab("params")} />
        <PanelTabButton label="Headers" count={headerCount} active={activeTab === "headers"} onClick={() => setActiveTab("headers")} />
        <PanelTabButton label="Body" count={bodyCount} active={activeTab === "body"} onClick={() => setActiveTab("body")} />
        <PanelTabButton label="Auth" count={authCount} active={activeTab === "auth"} onClick={() => setActiveTab("auth")} />
        <PanelTabButton
          label="Docs"
          count={descriptionCount}
          active={activeTab === "description"}
          onClick={() => setActiveTab("description")}
        />
      </nav>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "params" ? (
          <div>
            {/* Path Parameters */}
            {pathEntries.length > 0 ? (
              <div className="border-b border-vscode-panelBorder">
                <SectionHeader title="Path Parameters" />
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <TableHeaderRow columns={["", "Key", "Value", ""]} />
                    </thead>
                    <tbody>
                      {pathEntries.map(([key, value]) => (
                        <tr key={key} className="group border-b border-vscode-panelBorder last:border-b-0">
                          <td className="w-8 px-2 py-1.5 text-center">
                            <Lock size={11} className="text-vscode-descriptionFg" />
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="font-mono text-xs font-medium text-vscode-editorFg">{key}</span>
                            <span className="ml-1.5 rounded bg-orange-500/15 px-1 py-[1px] text-[9px] font-semibold text-orange-400">
                              required
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              value={value}
                              onChange={(event) => onPathParamChange(key, event.target.value)}
                              placeholder="Enter value"
                              className="w-full rounded border border-transparent bg-transparent px-2 py-1 font-mono text-xs text-vscode-inputFg hover:border-vscode-inputBorder focus:border-vscode-focusBorder focus:bg-vscode-inputBg focus:outline-none"
                            />
                          </td>
                          <td className="w-8" />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {/* Query Parameters */}
            <div>
              <div className="flex items-center justify-between border-b border-vscode-panelBorder px-3 py-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-vscode-descriptionFg">
                  Query Params
                </span>
                <button
                  type="button"
                  onClick={() => setIsQueryBulkEdit((prev) => !prev)}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                >
                  {isQueryBulkEdit ? <Table2 size={11} /> : <AlignJustify size={11} />}
                  {isQueryBulkEdit ? "Table" : "Bulk Edit"}
                </button>
              </div>

              {isQueryBulkEdit ? (
                <div className="p-3">
                  <textarea
                    value={queryBulkText}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setQueryBulkText(nextValue);
                      applyQueryBulkText(nextValue);
                    }}
                    className="h-28 w-full rounded-md border border-vscode-inputBorder bg-vscode-inputBg p-2 font-mono text-xs focus:border-vscode-focusBorder focus:outline-none"
                    placeholder="page=1&limit=20"
                  />
                </div>
              ) : (
                <div>
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <TableHeaderRow columns={["", "Key", "Value", ""]} />
                    </thead>
                    <tbody>
                      {editState.queryParams.map((row, index) => (
                        <KVTableRow
                          key={`query-${index}`}
                          row={row}
                          onChange={(updates) => updateQueryRow(index, updates)}
                          onDelete={() => {
                            const next = editState.queryParams.filter((_candidate, rowIndex) => rowIndex !== index);
                            onQueryParamsChange(next);
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                  <div className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onQueryParamsChange([...editState.queryParams, { key: "", value: "", enabled: true }])}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                    >
                      <Plus size={12} />
                      Add parameter
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === "headers" ? (
          <div>
            <div className="flex items-center gap-1.5 border-b border-vscode-panelBorder px-3 py-1.5">
              <button
                type="button"
                onClick={() => addHeaderPreset("json")}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
              >
                <Braces size={11} />
                JSON
              </button>
              <button
                type="button"
                onClick={() => addHeaderPreset("auth")}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
              >
                <Key size={11} />
                Auth
              </button>
            </div>

            <table className="w-full border-collapse text-xs">
              <thead>
                <TableHeaderRow columns={["", "Key", "Value", ""]} />
              </thead>
              <tbody>
                {editState.headers.map((row, index) => (
                  <KVTableRow
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
              </tbody>
            </table>

            <datalist id="postchat-header-suggestions">
              {COMMON_HEADERS.map((header) => (
                <option key={header} value={header} />
              ))}
            </datalist>

            <div className="px-3 py-2">
              <button
                type="button"
                onClick={() => onHeadersChange([...editState.headers, { key: "", value: "", enabled: true }])}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
              >
                <Plus size={12} />
                Add header
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === "body" ? (
          <div>
            {!canHaveBody ? (
              <div className="p-4 text-center">
                <p className="text-xs text-vscode-descriptionFg">
                  {editState.method.toUpperCase()} requests do not have a body.
                </p>
              </div>
            ) : (
              <>
                {/* Content type selector as pill bar */}
                <div className="flex items-center gap-1 border-b border-vscode-panelBorder px-3 py-2">
                  {[
                    { value: "none", label: "None" },
                    { value: "json", label: "JSON" },
                    { value: "form-data", label: "Form Data" },
                    { value: "urlencoded", label: "x-www-form" },
                    { value: "raw", label: "Raw" },
                    { value: "binary", label: "Binary" }
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onContentTypeChange(option.value)}
                      className={[
                        "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                        editState.contentType === option.value
                          ? "bg-vscode-buttonBg text-vscode-buttonFg"
                          : "text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                      ].join(" ")}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {editState.contentType === "json" ? (
                  <div>
                    <div className="flex items-center gap-1 border-b border-vscode-panelBorder px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            const parsed = JSON.parse(editState.body || "{}");
                            onBodyChange(JSON.stringify(parsed, null, 2));
                            setBodyValidation("Formatted");
                          } catch {
                            setBodyValidation("Invalid JSON");
                          }
                        }}
                        className="rounded-md px-2 py-0.5 text-[11px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                      >
                        Beautify
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            JSON.parse(editState.body || "{}");
                            setBodyValidation("Valid JSON");
                          } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            setBodyValidation(`Invalid: ${message}`);
                          }
                        }}
                        className="rounded-md px-2 py-0.5 text-[11px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                      >
                        Validate
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const generated = generateExampleFromSchema(editState.body);
                          if (generated) {
                            onBodyChange(JSON.stringify(generated, null, 2));
                            setBodyValidation("Generated");
                          } else {
                            setBodyValidation("Cannot generate");
                          }
                        }}
                        className="rounded-md px-2 py-0.5 text-[11px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                      >
                        Generate
                      </button>
                      {bodyValidation ? (
                        <span className={[
                          "ml-auto flex items-center gap-1 text-[10px]",
                          bodyValidation.startsWith("Valid") || bodyValidation === "Formatted" || bodyValidation === "Generated"
                            ? "text-green-400"
                            : "text-orange-400"
                        ].join(" ")}>
                          {bodyValidation.startsWith("Valid") || bodyValidation === "Formatted" || bodyValidation === "Generated"
                            ? <Check size={10} />
                            : <X size={10} />
                          }
                          {bodyValidation}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex overflow-hidden">
                      <pre className="m-0 min-w-[32px] select-none border-r border-vscode-panelBorder px-2 py-2 text-right font-mono text-[11px] leading-[18px] text-vscode-descriptionFg"
                        style={{ background: "var(--vscode-editorWidget-background)" }}
                      >
                        {buildLineNumbers(editState.body)}
                      </pre>
                      <textarea
                        value={editState.body}
                        onChange={(event) => { onBodyChange(event.target.value); setBodyValidation(null); }}
                        className="h-72 flex-1 resize-none p-2 font-mono text-xs leading-[18px] focus:outline-none"
                        style={{
                          background: "var(--vscode-input-background)",
                          color: "var(--vscode-input-foreground)"
                        }}
                      />
                    </div>
                  </div>
                ) : null}

                {(editState.contentType === "form-data" || editState.contentType === "urlencoded") && (
                  <div>
                    <div className="flex items-center border-b border-vscode-panelBorder px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => setIsFormRaw((prev) => !prev)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                      >
                        {isFormRaw ? <Table2 size={11} /> : <AlignJustify size={11} />}
                        {isFormRaw ? "Table view" : "Raw"}
                      </button>
                    </div>

                    {isFormRaw ? (
                      <div className="p-3">
                        <textarea
                          value={editState.body}
                          onChange={(event) => onBodyChange(event.target.value)}
                          className="h-40 w-full rounded-md border border-vscode-inputBorder bg-vscode-inputBg p-2 font-mono text-xs focus:border-vscode-focusBorder focus:outline-none"
                          placeholder="key=value&key2=value2"
                        />
                      </div>
                    ) : (
                      <div>
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <TableHeaderRow columns={["", "Key", "Value", ""]} />
                          </thead>
                          <tbody>
                            {formRows.map((row, index) => (
                              <KVTableRow
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
                          </tbody>
                        </table>
                        <div className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => updateFormRows([...formRows, { key: "", value: "", enabled: true }])}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                          >
                            <Plus size={12} />
                            Add field
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {editState.contentType === "raw" || editState.contentType === "binary" || editState.contentType === "none" ? (
                  <div className="p-0">
                    <textarea
                      value={editState.body}
                      onChange={(event) => onBodyChange(event.target.value)}
                      className="h-56 w-full resize-none border-0 p-3 font-mono text-xs focus:outline-none"
                      style={{
                        background: "var(--vscode-input-background)",
                        color: "var(--vscode-input-foreground)"
                      }}
                      placeholder={editState.contentType === "binary" ? "Binary payload placeholder" : "Request body"}
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {activeTab === "auth" ? (
          <div>
            {/* Auth type selector as pill bar */}
            <div className="flex items-center gap-1 border-b border-vscode-panelBorder px-3 py-2">
              {[
                { value: "none", label: "None" },
                { value: "bearer", label: "Bearer" },
                { value: "apikey", label: "API Key" },
                { value: "basic", label: "Basic" },
                { value: "oauth2", label: "OAuth 2.0" }
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    if (option.value === "none") {
                      onAuthChange("none", "");
                    } else if (option.value === "bearer") {
                      onAuthChange("bearer", "");
                    } else if (option.value === "apikey") {
                      onAuthChange("apikey", JSON.stringify({ name: "X-API-Key", value: "", in: "header" }));
                    } else if (option.value === "basic") {
                      onAuthChange("basic", JSON.stringify({ username: "", password: "" }));
                    } else {
                      onAuthChange("oauth2", JSON.stringify({ tokenUrl: "", clientId: "", clientSecret: "", token: "" }));
                    }
                  }}
                  className={[
                    "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                    editState.authType === option.value
                      ? "bg-vscode-buttonBg text-vscode-buttonFg"
                      : "text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                  ].join(" ")}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="p-3">
              {editState.authType === "none" ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <Shield size={28} strokeWidth={1.2} className="text-vscode-descriptionFg" />
                  <p className="text-xs text-vscode-descriptionFg">
                    No authentication configured for this request.
                  </p>
                </div>
              ) : null}

              {editState.authType === "bearer" ? (
                <AuthField
                  label="Token"
                  value={editState.authValue}
                  onChange={(value) => onAuthChange("bearer", value)}
                  placeholder="Paste bearer token"
                  mono
                />
              ) : null}

              {editState.authType === "apikey" ? (
                <div className="space-y-3">
                  <AuthField
                    label="Key Name"
                    value={apiKeyConfig.name}
                    onChange={(value) =>
                      onAuthChange("apikey", JSON.stringify({ ...apiKeyConfig, name: value || "X-API-Key" }))
                    }
                  />
                  <AuthField
                    label="Key Value"
                    value={apiKeyConfig.value}
                    onChange={(value) =>
                      onAuthChange("apikey", JSON.stringify({ ...apiKeyConfig, value }))
                    }
                    mono
                  />
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-vscode-descriptionFg">Add to</label>
                    <div className="flex gap-1">
                      {(["header", "query"] as const).map((placement) => (
                        <button
                          key={placement}
                          type="button"
                          onClick={() =>
                            onAuthChange("apikey", JSON.stringify({ ...apiKeyConfig, in: placement }))
                          }
                          className={[
                            "rounded-md px-2.5 py-1 text-xs capitalize transition-colors",
                            apiKeyConfig.in === placement
                              ? "bg-vscode-buttonBg text-vscode-buttonFg"
                              : "text-vscode-descriptionFg hover:bg-vscode-listHover"
                          ].join(" ")}
                        >
                          {placement === "query" ? "Query Params" : "Header"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {editState.authType === "basic" ? (
                <div className="space-y-3">
                  <AuthField
                    label="Username"
                    value={basicConfig.username}
                    onChange={(value) =>
                      onAuthChange("basic", JSON.stringify({ ...basicConfig, username: value }))
                    }
                  />
                  <AuthField
                    label="Password"
                    value={basicConfig.password}
                    onChange={(value) =>
                      onAuthChange("basic", JSON.stringify({ ...basicConfig, password: value }))
                    }
                    type="password"
                  />
                </div>
              ) : null}

              {editState.authType === "oauth2" ? (
                <div className="space-y-3">
                  <AuthField
                    label="Token URL"
                    value={oauthConfig.tokenUrl}
                    onChange={(value) =>
                      onAuthChange("oauth2", JSON.stringify({ ...oauthConfig, tokenUrl: value }))
                    }
                    mono
                  />
                  <AuthField
                    label="Client ID"
                    value={oauthConfig.clientId}
                    onChange={(value) =>
                      onAuthChange("oauth2", JSON.stringify({ ...oauthConfig, clientId: value }))
                    }
                    mono
                  />
                  <AuthField
                    label="Client Secret"
                    value={oauthConfig.clientSecret}
                    onChange={(value) =>
                      onAuthChange("oauth2", JSON.stringify({ ...oauthConfig, clientSecret: value }))
                    }
                    mono
                    type="password"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onOAuthTokenRequest(oauthConfig.tokenUrl, oauthConfig.clientId, oauthConfig.clientSecret)
                    }
                    className="inline-flex items-center gap-1.5 rounded-md bg-vscode-buttonBg px-3 py-1.5 text-xs font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover"
                  >
                    <Key size={12} />
                    Get Token
                  </button>
                  {oauthConfig.token ? (
                    <div className="flex items-center gap-1.5 rounded-md bg-green-500/10 px-2.5 py-1.5 text-xs text-green-400">
                      <Check size={12} />
                      Token loaded
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeTab === "description" ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {endpoint?.description?.trim() ? (
                <div className="prose prose-sm max-w-none text-vscode-editorFg">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{endpoint.description}</ReactMarkdown>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <p className="text-xs text-vscode-descriptionFg">No description available for this endpoint.</p>
                </div>
              )}
            </div>
            {endpoint ? (
              <div className="border-t border-vscode-panelBorder px-3 py-2">
                <button
                  type="button"
                  onClick={() => {
                    vscode.postMessage({ command: "highlightInExplorer", endpointId: endpoint.id });
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-vscode-linkFg hover:underline"
                >
                  <ExternalLink size={11} />
                  View in Explorer
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ── Subcomponents ── */

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
        "relative inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors",
        active
          ? "text-vscode-editorFg"
          : "text-vscode-descriptionFg hover:text-vscode-editorFg"
      ].join(" ")}
    >
      {label}
      {count > 0 ? (
        <span className="rounded-full bg-vscode-badgeBg px-1.5 text-[9px] leading-[16px] text-vscode-badgeFg">
          {count}
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

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="border-b border-vscode-panelBorder px-3 py-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-vscode-descriptionFg">
        {title}
      </span>
    </div>
  );
}

function TableHeaderRow({ columns }: { columns: string[] }) {
  return (
    <tr
      className="border-b border-vscode-panelBorder text-[10px] font-semibold uppercase tracking-wider text-vscode-descriptionFg"
      style={{ background: "var(--vscode-editorWidget-background)" }}
    >
      {columns.map((col, i) => (
        <th key={i} className={[
          "px-2 py-1 text-left font-semibold",
          i === 0 ? "w-8" : "",
          i === columns.length - 1 ? "w-8" : ""
        ].join(" ")}>
          {col}
        </th>
      ))}
    </tr>
  );
}

function KVTableRow({
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
    <tr className="group border-b border-vscode-panelBorder last:border-b-0 hover:bg-vscode-listHover">
      <td className="w-8 px-2 py-1.5 text-center">
        <input
          type="checkbox"
          checked={row.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
          className="h-3.5 w-3.5 cursor-pointer accent-vscode-focusBorder"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          value={row.key}
          list={datalistId}
          onChange={(event) => onChange({ key: event.target.value })}
          placeholder="Key"
          className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 font-mono text-xs text-vscode-inputFg hover:border-vscode-inputBorder focus:border-vscode-focusBorder focus:bg-vscode-inputBg focus:outline-none"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          value={row.value}
          onChange={(event) => onChange({ value: event.target.value })}
          placeholder="Value"
          className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 font-mono text-xs text-vscode-inputFg hover:border-vscode-inputBorder focus:border-vscode-focusBorder focus:bg-vscode-inputBg focus:outline-none"
        />
      </td>
      <td className="w-8 px-1 py-1.5 text-center">
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-0.5 text-vscode-descriptionFg opacity-0 transition-opacity group-hover:opacity-100 hover:bg-vscode-listHover hover:text-red-400"
          aria-label="Remove row"
        >
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
  );
}

function AuthField({
  label,
  value,
  onChange,
  placeholder,
  mono = false,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: "text" | "password";
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-vscode-descriptionFg">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={[
          "w-full rounded-md border border-vscode-inputBorder bg-vscode-inputBg px-2.5 py-1.5 text-xs focus:border-vscode-focusBorder focus:outline-none",
          mono ? "font-mono" : ""
        ].join(" ")}
      />
    </div>
  );
}

/* ── Helpers ── */

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
