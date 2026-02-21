import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  Search,
  X,
  ChevronRight,
  FolderClosed,
  FolderOpen,
  Play,
  Clock,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Filter
} from "lucide-react";
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

const METHOD_COLORS: Record<string, { text: string; bg: string; activeBg: string; border: string }> = {
  GET: { text: "text-blue-400", bg: "bg-blue-500/10", activeBg: "bg-blue-500/20", border: "border-blue-500/30" },
  POST: { text: "text-green-400", bg: "bg-green-500/10", activeBg: "bg-green-500/20", border: "border-green-500/30" },
  PUT: { text: "text-orange-400", bg: "bg-orange-500/10", activeBg: "bg-orange-500/20", border: "border-orange-500/30" },
  PATCH: { text: "text-yellow-400", bg: "bg-yellow-500/10", activeBg: "bg-yellow-500/20", border: "border-yellow-500/30" },
  DELETE: { text: "text-red-400", bg: "bg-red-500/10", activeBg: "bg-red-500/20", border: "border-red-500/30" },
  HEAD: { text: "text-gray-400", bg: "bg-gray-500/10", activeBg: "bg-gray-500/20", border: "border-gray-500/30" },
  OPTIONS: { text: "text-gray-400", bg: "bg-gray-500/10", activeBg: "bg-gray-500/20", border: "border-gray-500/30" }
};

const METHOD_ACCENT_COLORS: Record<string, string> = {
  GET: "#60a5fa",
  POST: "#4ade80",
  PUT: "#fb923c",
  PATCH: "#facc15",
  DELETE: "#f87171",
  HEAD: "#9ca3af",
  OPTIONS: "#9ca3af"
};

function getMethodColors(method: string) {
  return METHOD_COLORS[method] ?? METHOD_COLORS.GET;
}

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
    <div className="flex h-full min-h-0 flex-col text-[13px]" tabIndex={0} onKeyDown={handleKeyDown}>
      {/* Search & Filters */}
      <div className="border-b border-vscode-panelBorder px-3 py-2.5">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-vscode-descriptionFg"
            aria-hidden="true"
          />
          <input
            id="postchat-endpoint-search"
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Filter endpoints..."
            className="w-full rounded-md py-[5px] pl-8 pr-8 text-xs outline-none"
            style={{
              background: "var(--vscode-input-background)",
              color: "var(--vscode-input-foreground)",
              border: "1px solid var(--vscode-input-border, transparent)"
            }}
          />
          {searchQuery.length > 0 ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          ) : null}
        </div>

        <div className="mt-2 flex items-center gap-1">
          <Filter size={11} className="mr-0.5 text-vscode-descriptionFg" aria-hidden="true" />
          {METHOD_FILTERS.map((method) => {
            const active = activeMethods.has(method);
            const colors = method === "ALL" ? null : getMethodColors(method);
            return (
              <button
                key={method}
                type="button"
                onClick={() => handleMethodToggle(method)}
                className={[
                  "rounded px-1.5 py-[1px] text-[10px] font-semibold tracking-wide transition-colors",
                  active && method === "ALL"
                    ? "bg-vscode-buttonBg text-vscode-buttonFg"
                    : active && colors
                      ? `${colors.activeBg} ${colors.text} border ${colors.border}`
                      : method === "ALL"
                        ? "text-vscode-descriptionFg hover:text-vscode-editorFg"
                        : colors
                          ? `${colors.text} opacity-50 hover:opacity-80`
                          : "text-vscode-descriptionFg"
                ].join(" ")}
              >
                {method}
              </button>
            );
          })}
        </div>

        {filtersActive ? (
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-vscode-descriptionFg">
            <span>{filteredEndpoints.length} of {endpoints.length} endpoints</span>
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-vscode-linkFg hover:underline"
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>

      {/* Scrollable endpoint list */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {showDoubleClickHint ? (
          <div className="mx-2 mb-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] text-vscode-descriptionFg"
            style={{ background: "var(--vscode-editorWidget-background)" }}
          >
            <span className="flex-1">Double-click to open as tab</span>
            <button
              type="button"
              onClick={dismissDoubleClickHint}
              className="rounded p-0.5 hover:bg-vscode-listHover"
              aria-label="Dismiss hint"
            >
              <X size={12} />
            </button>
          </div>
        ) : null}

        {groupedEndpoints.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-vscode-descriptionFg">
              {normalizedSearch
                ? `No endpoints match "${searchQuery}"`
                : "No endpoints match current filters."}
            </p>
            <button
              type="button"
              onClick={clearAllFilters}
              className="mt-2 text-xs text-vscode-linkFg hover:underline"
            >
              Clear all filters
            </button>
          </div>
        ) : null}

        {groupedEndpoints.map(([folderName, folderEndpoints]) => {
          const isOpen = collapsedFolders[folderName] ?? true;

          return (
            <div key={folderName} className="mb-0.5">
              {/* Folder header */}
              <button
                type="button"
                onClick={() => handleToggleFolder(folderName)}
                className="group/folder flex w-full items-center gap-1 px-2 py-[5px] text-left hover:bg-vscode-listHover"
              >
                <ChevronRight
                  size={14}
                  className={[
                    "shrink-0 text-vscode-descriptionFg transition-transform duration-150",
                    isOpen ? "rotate-90" : "rotate-0"
                  ].join(" ")}
                  aria-hidden="true"
                />
                {isOpen ? (
                  <FolderOpen size={14} className="shrink-0 text-vscode-descriptionFg" aria-hidden="true" />
                ) : (
                  <FolderClosed size={14} className="shrink-0 text-vscode-descriptionFg" aria-hidden="true" />
                )}
                <span className="min-w-0 truncate text-xs font-semibold text-vscode-editorFg">
                  {folderName}
                </span>
                <span className="ml-auto shrink-0 rounded-full bg-vscode-badgeBg px-1.5 text-[10px] leading-[18px] text-vscode-badgeFg">
                  {folderEndpoints.length}
                </span>
              </button>

              {/* Endpoint list */}
              {isOpen ? (
                <ul>
                  {folderEndpoints.map((endpoint) => {
                    const selected = selectedId === endpoint.id;
                    const hasSuccess = runResults.has(endpoint.id);
                    const hasError = runErrors.has(endpoint.id);
                    const pulsing = highlightedEndpointId === endpoint.id;
                    const colors = getMethodColors(endpoint.method);
                    const accentColor = METHOD_ACCENT_COLORS[endpoint.method] ?? "#60a5fa";

                    return (
                      <li
                        key={endpoint.id}
                        ref={(node) => {
                          rowRefs.current[endpoint.id] = node;
                        }}
                        onClick={() => onSelect(endpoint)}
                        onDoubleClick={() => handleEndpointDoubleClick(endpoint)}
                        className={[
                          "group relative cursor-pointer pl-7 pr-2 py-[5px]",
                          pulsing ? "postchat-endpoint-pulse" : "",
                          selected ? "" : "hover:bg-vscode-listHover"
                        ].join(" ")}
                        style={{
                          background: selected
                            ? "var(--vscode-list-activeSelectionBackground)"
                            : undefined
                        }}
                      >
                        {/* Left accent bar for selected */}
                        {selected ? (
                          <div
                            className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r"
                            style={{ background: accentColor }}
                            aria-hidden="true"
                          />
                        ) : null}

                        {/* Tree indent line */}
                        <div
                          className="absolute left-[18px] top-0 bottom-0 w-px"
                          style={{ background: "var(--vscode-editorIndentGuide-background, rgba(128,128,128,0.15))" }}
                          aria-hidden="true"
                        />

                        <div className="relative z-10 flex items-center gap-2">
                          <span
                            className={[
                              "inline-flex w-[52px] shrink-0 items-center justify-center rounded py-[1px] font-mono text-[10px] font-bold leading-[16px]",
                              colors.bg,
                              colors.text,
                              `border ${colors.border}`
                            ].join(" ")}
                          >
                            {endpoint.method}
                          </span>

                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="truncate text-xs font-medium text-vscode-editorFg">
                              {endpoint.name}
                            </div>
                            <div className="truncate font-mono text-[11px] text-vscode-descriptionFg">
                              {endpoint.path}
                            </div>
                          </div>

                          {/* Status icon */}
                          {hasError ? (
                            <span className="shrink-0" title="Request failed">
                              <XCircle size={13} className="text-red-400" />
                            </span>
                          ) : hasSuccess ? (
                            <span className="shrink-0" title="Request succeeded">
                              <CheckCircle2 size={13} className="text-green-400" />
                            </span>
                          ) : null}

                          {/* Run button on hover */}
                          <button
                            type="button"
                            onClick={(event) => handleRunClick(event, endpoint)}
                            className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-vscode-buttonBg hover:text-vscode-buttonFg"
                            title="Run endpoint"
                            aria-label={`Run ${endpoint.name}`}
                          >
                            <Play size={12} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}

        {/* Recently Opened section */}
        <div className="mt-1 border-t border-vscode-panelBorder pt-1">
          <button
            type="button"
            onClick={() => setRecentCollapsed((prev) => !prev)}
            className="flex w-full items-center gap-1 px-2 py-[5px] text-left hover:bg-vscode-listHover"
          >
            <ChevronRight
              size={14}
              className={[
                "shrink-0 text-vscode-descriptionFg transition-transform duration-150",
                recentCollapsed ? "rotate-0" : "rotate-90"
              ].join(" ")}
              aria-hidden="true"
            />
            <Clock size={14} className="shrink-0 text-vscode-descriptionFg" aria-hidden="true" />
            <span className="text-xs font-semibold text-vscode-editorFg">Recently Opened</span>
            <span className="ml-auto shrink-0 rounded-full bg-vscode-badgeBg px-1.5 text-[10px] leading-[18px] text-vscode-badgeFg">
              {recentlyOpened.length}
            </span>
          </button>

          {!recentCollapsed ? (
            recentlyOpened.length > 0 ? (
              <ul>
                {recentlyOpened.map((endpoint) => {
                  const colors = getMethodColors(endpoint.method);
                  return (
                    <li
                      key={`recent-${endpoint.id}`}
                      onClick={() => handleRecentReopen(endpoint)}
                      className="group relative cursor-pointer py-[4px] pl-7 pr-2 hover:bg-vscode-listHover"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={[
                            "inline-flex w-[52px] shrink-0 items-center justify-center rounded py-[1px] font-mono text-[10px] font-bold leading-[16px]",
                            colors.bg,
                            colors.text,
                            `border ${colors.border}`
                          ].join(" ")}
                        >
                          {endpoint.method}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-vscode-editorFg">
                          {endpoint.name}
                        </span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRecentReopen(endpoint);
                          }}
                          className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-vscode-buttonBg hover:text-vscode-buttonFg"
                          title="Re-open tab"
                          aria-label={`Re-open ${endpoint.name}`}
                        >
                          <ExternalLink size={12} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-7 py-2 text-[11px] text-vscode-descriptionFg">No tabs opened yet.</p>
            )
          ) : null}
        </div>
      </div>

      {/* Bottom status bar */}
      <div
        className="flex items-center gap-1.5 border-t border-vscode-panelBorder px-3 py-1 text-[11px] text-vscode-descriptionFg"
      >
        {selectedEndpoint ? (
          <>
            <span
              className={[
                "inline-flex w-[36px] shrink-0 items-center justify-center rounded font-mono text-[9px] font-bold leading-[14px]",
                getMethodColors(selectedEndpoint.method).bg,
                getMethodColors(selectedEndpoint.method).text
              ].join(" ")}
            >
              {selectedEndpoint.method}
            </span>
            <span className="truncate">{selectedEndpoint.name}</span>
          </>
        ) : (
          <span>No endpoint selected</span>
        )}
      </div>
    </div>
  );
}
