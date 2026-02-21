import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { ExecutionResult } from "../RequestResult";
import type { ParsedEndpoint } from "../../types/spec";
import { vscode } from "../../vscode";

type EndpointSidebarProps = {
  endpoints: ParsedEndpoint[];
  selectedId: string | null;
  onSelect: (endpoint: ParsedEndpoint) => void;
  onOpenRequestTab: (endpoint: ParsedEndpoint) => void;
  onRunRequest: (
    endpoint: ParsedEndpoint
  ) => Promise<ExecutionResult | null> | ExecutionResult | null | void;
  runResults: Map<string, ExecutionResult>;
  runErrors: Map<string, string>;
  highlightedEndpointId: string | null;
  focusSearchSignal?: number;
  clearSearchSignal?: number;
  onSearchQueryChange?: (query: string) => void;
  onEscapeNoSearch?: () => void;
  recentlyOpened: ParsedEndpoint[];
  onReopenRecent: (endpoint: ParsedEndpoint) => void;
};

type MethodFilter = "ALL" | "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const METHOD_FILTERS: MethodFilter[] = ["ALL", "GET", "POST", "PUT", "PATCH", "DELETE"];
const OPEN_HINT_STORAGE_KEY = "postchat.explorer.doubleClickHintDismissed";

const METHOD_BADGE_STYLES: Record<ParsedEndpoint["method"], string> = {
  GET: "bg-blue-600/20 text-blue-400 border border-blue-600/30",
  POST: "bg-green-600/20 text-green-400 border border-green-600/30",
  PUT: "bg-orange-600/20 text-orange-400 border border-orange-600/30",
  PATCH: "bg-yellow-600/20 text-yellow-400 border border-yellow-600/30",
  DELETE: "bg-red-600/20 text-red-400 border border-red-600/30",
  HEAD: "bg-gray-600/20 text-gray-400 border border-gray-600/30",
  OPTIONS: "bg-gray-600/20 text-gray-400 border border-gray-600/30"
};

function groupByFolder(endpoints: ParsedEndpoint[]): Array<[string, ParsedEndpoint[]]> {
  const grouped = new Map<string, ParsedEndpoint[]>();
  for (const endpoint of endpoints) {
    const folder = endpoint.folder || "General";
    const bucket = grouped.get(folder);
    if (bucket) {
      bucket.push(endpoint);
    } else {
      grouped.set(folder, [endpoint]);
    }
  }

  return Array.from(grouped.entries());
}

function readHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(OPEN_HINT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHintDismissed(): void {
  try {
    window.localStorage.setItem(OPEN_HINT_STORAGE_KEY, "1");
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

export function EndpointSidebar({
  endpoints,
  selectedId,
  onSelect,
  onOpenRequestTab,
  onRunRequest,
  runResults,
  runErrors,
  highlightedEndpointId,
  focusSearchSignal = 0,
  clearSearchSignal = 0,
  onSearchQueryChange,
  onEscapeNoSearch,
  recentlyOpened,
  onReopenRecent
}: EndpointSidebarProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMethods, setActiveMethods] = useState<Set<MethodFilter>>(() => new Set(["ALL"]));
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [showDoubleClickHint, setShowDoubleClickHint] = useState<boolean>(() => !readHintDismissed());
  const [recentCollapsed, setRecentCollapsed] = useState(true);

  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredEndpoints = useMemo(() => {
    return endpoints.filter((endpoint) => {
      const matchesMethod =
        activeMethods.has("ALL") ||
        (activeMethods.has(endpoint.method as MethodFilter) &&
          endpoint.method !== "HEAD" &&
          endpoint.method !== "OPTIONS");

      if (!matchesMethod) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = `${endpoint.name} ${endpoint.path} ${endpoint.method} ${endpoint.description ?? ""}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [activeMethods, endpoints, normalizedSearch]);

  const groupedEndpoints = useMemo(() => groupByFolder(filteredEndpoints), [filteredEndpoints]);
  const selectedEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === selectedId) ?? null,
    [endpoints, selectedId]
  );

  useEffect(() => {
    setCollapsedFolders((prev) => {
      const next: Record<string, boolean> = {};
      for (const [folderName] of groupedEndpoints) {
        next[folderName] = prev[folderName] ?? true;
      }
      return next;
    });
  }, [groupedEndpoints]);

  useEffect(() => {
    if (!highlightedEndpointId) {
      return;
    }

    const node = rowRefs.current[highlightedEndpointId];
    if (!node) {
      return;
    }

    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedEndpointId]);

  useEffect(() => {
    onSearchQueryChange?.(searchQuery);
  }, [onSearchQueryChange, searchQuery]);

  useEffect(() => {
    if (focusSearchSignal > 0) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [focusSearchSignal]);

  useEffect(() => {
    if (clearSearchSignal > 0) {
      setSearchQuery("");
    }
  }, [clearSearchSignal]);

  const filtersActive = normalizedSearch.length > 0 || !activeMethods.has("ALL");

  const handleMethodToggle = useCallback((method: MethodFilter) => {
    setActiveMethods((prev) => {
      if (method === "ALL") {
        return new Set(["ALL"]);
      }

      const next = new Set(prev);
      next.delete("ALL");

      if (next.has(method)) {
        next.delete(method);
      } else {
        next.add(method);
      }

      if (next.size === 0) {
        next.add("ALL");
      }

      return next;
    });
  }, []);

  const handleToggleFolder = useCallback((folderName: string) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderName]: !prev[folderName]
    }));
  }, []);

  const handleRunClick = useCallback(
    (event: MouseEvent, endpoint: ParsedEndpoint) => {
      event.stopPropagation();
      void onRunRequest(endpoint);
    },
    [onRunRequest]
  );

  const clearAllFilters = useCallback(() => {
    setSearchQuery("");
    setActiveMethods(new Set(["ALL"]));
  }, []);

  const dismissDoubleClickHint = useCallback(() => {
    setShowDoubleClickHint(false);
    writeHintDismissed();
  }, []);

  const handleEndpointDoubleClick = useCallback(
    (endpoint: ParsedEndpoint) => {
      dismissDoubleClickHint();
      vscode.postMessage({ command: "openRequestTab", endpointId: endpoint.id });
      onOpenRequestTab(endpoint);
    },
    [dismissDoubleClickHint, onOpenRequestTab]
  );

  const handleRecentReopen = useCallback(
    (endpoint: ParsedEndpoint) => {
      onSelect(endpoint);
      vscode.postMessage({ command: "openRequestTab", endpointId: endpoint.id });
      onReopenRecent(endpoint);
    },
    [onReopenRecent, onSelect]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        if (searchQuery.length > 0) {
          event.preventDefault();
          setSearchQuery("");
        } else {
          onEscapeNoSearch?.();
        }
        return;
      }

      if (filteredEndpoints.length === 0) {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();

        const selectedIndex = filteredEndpoints.findIndex((endpoint) => endpoint.id === selectedId);
        const direction = event.key === "ArrowDown" ? 1 : -1;

        const nextIndex =
          selectedIndex === -1
            ? direction > 0
              ? 0
              : filteredEndpoints.length - 1
            : (selectedIndex + direction + filteredEndpoints.length) % filteredEndpoints.length;

        const next = filteredEndpoints[nextIndex];
        if (next) {
          onSelect(next);
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const selected =
          filteredEndpoints.find((endpoint) => endpoint.id === selectedId) ?? filteredEndpoints[0];
        if (selected) {
          onSelect(selected);
        }
      }
    },
    [filteredEndpoints, onEscapeNoSearch, onSelect, searchQuery, selectedId]
  );

  return (
    <div className="flex h-full min-h-0 flex-col" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="border-b border-vscode-panelBorder px-3 py-3">
        <div className="relative">
          <input
            id="postchat-endpoint-search"
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search endpoints..."
            className="w-full rounded border border-vscode-inputBorder px-2.5 py-1.5 pr-8 text-sm outline-none"
            style={{
              background: "var(--vscode-input-background)",
              color: "var(--vscode-input-foreground)"
            }}
          />
          {searchQuery.length > 0 ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-sm text-vscode-descriptionFg hover:bg-vscode-listHover"
              aria-label="Clear search"
            >
              ×
            </button>
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {METHOD_FILTERS.map((method) => {
            const active = activeMethods.has(method);
            return (
              <button
                key={method}
                type="button"
                onClick={() => handleMethodToggle(method)}
                className="rounded-full border px-2 py-0.5 text-xs font-medium transition-colors"
                style={
                  active
                    ? {
                        background: "var(--vscode-button-background)",
                        color: "var(--vscode-button-foreground)",
                        borderColor: "var(--vscode-button-background)"
                      }
                    : undefined
                }
              >
                {method}
              </button>
            );
          })}
        </div>

        {filtersActive ? (
          <p className="mt-2 text-xs text-vscode-descriptionFg">
            Showing {filteredEndpoints.length} of {endpoints.length} endpoints
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {showDoubleClickHint ? (
          <div className="mb-2 rounded border border-vscode-focusBorder bg-vscode-editorWidget-background px-2 py-1.5 text-xs text-vscode-descriptionFg">
            Double-click any endpoint to open it as a tab
          </div>
        ) : null}

        {groupedEndpoints.length === 0 ? (
          <div className="px-2 py-3">
            <p className="text-sm text-vscode-descriptionFg">
              {normalizedSearch
                ? `No endpoints match '${searchQuery}'`
                : "No endpoints match current filters."}
            </p>
            <button
              type="button"
              onClick={clearAllFilters}
              className="mt-2 rounded bg-vscode-buttonSecondaryBg px-2 py-1 text-xs text-vscode-buttonSecondaryFg hover:bg-vscode-buttonSecondaryHover"
            >
              Clear filters
            </button>
          </div>
        ) : null}

        {groupedEndpoints.map(([folderName, folderEndpoints]) => {
          const isOpen = collapsedFolders[folderName] ?? true;

          return (
            <section key={folderName} className="mb-1 overflow-hidden rounded border border-vscode-panelBorder">
              <button
                type="button"
                onClick={() => handleToggleFolder(folderName)}
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-semibold"
              >
                <span
                  className={[
                    "inline-block text-vscode-descriptionFg transition-transform duration-150",
                    isOpen ? "rotate-90" : "rotate-0"
                  ].join(" ")}
                  aria-hidden="true"
                >
                  ▶
                </span>
                <span className="truncate text-vscode-editorFg">{folderName}</span>
                <span className="ml-auto rounded bg-vscode-badgeBg px-1.5 py-0.5 text-[10px] text-vscode-badgeFg">
                  {folderEndpoints.length}
                </span>
              </button>

              {isOpen ? (
                <ul className="divide-y divide-vscode-panelBorder">
                  {folderEndpoints.map((endpoint) => {
                    const selected = selectedId === endpoint.id;
                    const hasSuccess = runResults.has(endpoint.id);
                    const hasError = runErrors.has(endpoint.id);
                    const dotColor = hasError ? "text-red-400" : hasSuccess ? "text-green-400" : "";
                    const pulsing = highlightedEndpointId === endpoint.id;

                    return (
                      <li
                        key={endpoint.id}
                        ref={(node) => {
                          rowRefs.current[endpoint.id] = node;
                        }}
                        onClick={() => onSelect(endpoint)}
                        onDoubleClick={() => handleEndpointDoubleClick(endpoint)}
                        className={[
                          "group relative cursor-pointer px-2 py-1.5",
                          pulsing ? "postchat-endpoint-pulse" : ""
                        ].join(" ")}
                        style={{
                          background: selected
                            ? "var(--vscode-list-activeSelectionBackground)"
                            : undefined
                        }}
                      >
                        {!selected ? (
                          <div
                            className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
                            style={{ background: "var(--vscode-list-hoverBackground)" }}
                            aria-hidden="true"
                          />
                        ) : null}

                        <div className="relative z-10 flex items-start gap-2">
                          <span
                            className={[
                              "mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                              METHOD_BADGE_STYLES[endpoint.method]
                            ].join(" ")}
                          >
                            {endpoint.method}
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-vscode-editorFg">
                              {endpoint.name}
                            </div>
                            <div className="truncate text-xs text-vscode-descriptionFg">{endpoint.path}</div>
                          </div>

                          {hasSuccess || hasError ? (
                            <span
                              className={["text-sm", dotColor].join(" ")}
                              title={hasError ? "Request failed" : "Request succeeded"}
                              aria-label={hasError ? "Request failed" : "Request succeeded"}
                            >
                              ●
                            </span>
                          ) : null}

                          <button
                            type="button"
                            onClick={(event) => handleRunClick(event, endpoint)}
                            className="rounded px-1 text-xs opacity-0 transition-opacity group-hover:opacity-100 hover:bg-vscode-buttonBg hover:text-vscode-buttonFg"
                            title="Run endpoint"
                            aria-label={`Run ${endpoint.name}`}
                          >
                            ▶
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          );
        })}

        <section className="mt-2 overflow-hidden rounded border border-vscode-panelBorder">
          <button
            type="button"
            onClick={() => setRecentCollapsed((prev) => !prev)}
            className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-semibold"
          >
            <span
              className={[
                "inline-block text-vscode-descriptionFg transition-transform duration-150",
                recentCollapsed ? "rotate-0" : "rotate-90"
              ].join(" ")}
              aria-hidden="true"
            >
              ▶
            </span>
            <span className="truncate text-vscode-editorFg">Recently Opened</span>
            <span className="ml-auto rounded bg-vscode-badgeBg px-1.5 py-0.5 text-[10px] text-vscode-badgeFg">
              {recentlyOpened.length}
            </span>
          </button>

          {!recentCollapsed ? (
            recentlyOpened.length > 0 ? (
              <ul className="divide-y divide-vscode-panelBorder">
                {recentlyOpened.map((endpoint) => (
                  <li
                    key={`recent-${endpoint.id}`}
                    onClick={() => handleRecentReopen(endpoint)}
                    className="group relative cursor-pointer px-2 py-1.5"
                  >
                    <div
                      className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ background: "var(--vscode-list-hoverBackground)" }}
                      aria-hidden="true"
                    />

                    <div className="relative z-10 flex items-center gap-2">
                      <span
                        className={[
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          METHOD_BADGE_STYLES[endpoint.method]
                        ].join(" ")}
                      >
                        {endpoint.method}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-vscode-editorFg">{endpoint.name}</span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRecentReopen(endpoint);
                        }}
                        className="rounded px-1 text-[11px] text-vscode-descriptionFg hover:bg-vscode-buttonBg hover:text-vscode-buttonFg"
                        title="Re-open tab"
                        aria-label={`Re-open ${endpoint.name}`}
                      >
                        ↗
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-2 text-xs text-vscode-descriptionFg">No tabs opened yet.</p>
            )
          ) : null}
        </section>
      </div>

      <div className="border-t border-vscode-panelBorder px-2 py-1 text-[11px] text-vscode-descriptionFg">
        {selectedEndpoint ? `Selected: ${selectedEndpoint.name}` : "No endpoint selected"}
      </div>
    </div>
  );
}
