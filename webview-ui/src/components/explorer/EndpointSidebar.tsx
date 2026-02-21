import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { ExecutionResult } from "../RequestResult";
import type { ParsedEndpoint } from "../../types/spec";

type EndpointSidebarProps = {
  endpoints: ParsedEndpoint[];
  selectedId: string | null;
  selectedEndpoint: ParsedEndpoint | null;
  onSelect: (endpoint: ParsedEndpoint) => void;
  onRunRequest: (
    endpoint: ParsedEndpoint
  ) => Promise<ExecutionResult | null> | ExecutionResult | null | void;
};

type MethodFilter = "ALL" | "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type RunDotState = { kind: "success" | "error"; fading: boolean };

const METHOD_FILTERS: MethodFilter[] = ["ALL", "GET", "POST", "PUT", "PATCH", "DELETE"];

const METHOD_BADGE_STYLES: Record<ParsedEndpoint["method"], string> = {
  GET: "bg-blue-600/20 text-blue-400 border border-blue-600/30",
  POST: "bg-green-600/20 text-green-400 border border-green-600/30",
  PUT: "bg-orange-600/20 text-orange-400 border border-orange-600/30",
  PATCH: "bg-yellow-600/20 text-yellow-400 border border-yellow-600/30",
  DELETE: "bg-red-600/20 text-red-400 border border-red-600/30",
  HEAD: "bg-gray-600/20 text-gray-400 border border-gray-600/30",
  OPTIONS: "bg-gray-600/20 text-gray-400 border border-gray-600/30"
};

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value;
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

export function EndpointSidebar({
  endpoints,
  selectedId,
  selectedEndpoint,
  onSelect,
  onRunRequest
}: EndpointSidebarProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMethods, setActiveMethods] = useState<Set<MethodFilter>>(() => new Set(["ALL"]));
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [runDots, setRunDots] = useState<Record<string, RunDotState>>({});
  const fadeTimersRef = useRef<Record<string, number>>({});
  const clearTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    return () => {
      Object.values(fadeTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
      Object.values(clearTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredEndpoints = useMemo(() => {
    return endpoints.filter((endpoint) => {
      const matchesMethod =
        activeMethods.has("ALL") ||
        (activeMethods.has(endpoint.method as MethodFilter) && endpoint.method !== "HEAD" && endpoint.method !== "OPTIONS");

      if (!matchesMethod) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = `${endpoint.name} ${endpoint.path} ${endpoint.method}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [activeMethods, endpoints, normalizedSearch]);

  const groupedEndpoints = useMemo(() => groupByFolder(filteredEndpoints), [filteredEndpoints]);

  useEffect(() => {
    setCollapsedFolders((prev) => {
      const next: Record<string, boolean> = {};
      for (const [folderName] of groupedEndpoints) {
        next[folderName] = prev[folderName] ?? true;
      }
      return next;
    });
  }, [groupedEndpoints]);

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

  const markRunDot = useCallback((endpointId: string, kind: "success" | "error") => {
    if (fadeTimersRef.current[endpointId]) {
      window.clearTimeout(fadeTimersRef.current[endpointId]);
    }
    if (clearTimersRef.current[endpointId]) {
      window.clearTimeout(clearTimersRef.current[endpointId]);
    }

    setRunDots((prev) => ({
      ...prev,
      [endpointId]: { kind, fading: false }
    }));

    fadeTimersRef.current[endpointId] = window.setTimeout(() => {
      setRunDots((prev) => {
        const current = prev[endpointId];
        if (!current) {
          return prev;
        }

        return {
          ...prev,
          [endpointId]: {
            ...current,
            fading: true
          }
        };
      });
    }, 2500);

    clearTimersRef.current[endpointId] = window.setTimeout(() => {
      setRunDots((prev) => {
        const next = { ...prev };
        delete next[endpointId];
        return next;
      });
      delete fadeTimersRef.current[endpointId];
      delete clearTimersRef.current[endpointId];
    }, 3000);
  }, []);

  const handleRunClick = useCallback(
    async (event: MouseEvent, endpoint: ParsedEndpoint) => {
      event.stopPropagation();

      const maybeResult = onRunRequest(endpoint);
      let result: ExecutionResult | null | undefined;

      if (isPromiseLike<ExecutionResult | null>(maybeResult)) {
        result = await maybeResult;
      } else {
        result = maybeResult;
      }

      if (!result) {
        return;
      }

      markRunDot(endpoint.id, result.status >= 400 ? "error" : "success");
    },
    [markRunDot, onRunRequest]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        if (searchQuery.length > 0) {
          event.preventDefault();
          setSearchQuery("");
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
    [filteredEndpoints, onSelect, searchQuery, selectedId]
  );

  return (
    <div className="flex h-full min-h-0 flex-col" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="border-b border-vscode-panelBorder px-3 py-3">
        <div className="relative">
          <input
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
        {groupedEndpoints.length === 0 ? (
          <p className="px-2 py-3 text-sm text-vscode-descriptionFg">No endpoints match current filters.</p>
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
                    const runDot = runDots[endpoint.id];
                    const dotColor = runDot?.kind === "success" ? "text-green-400" : "text-red-400";

                    return (
                      <li
                        key={endpoint.id}
                        onClick={() => onSelect(endpoint)}
                        className="group relative cursor-pointer px-2 py-1.5"
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

                          {runDot ? (
                            <span
                              className={[
                                "text-sm transition-opacity duration-500",
                                dotColor,
                                runDot.fading ? "opacity-0" : "opacity-100"
                              ].join(" ")}
                              title={runDot.kind === "success" ? "Request succeeded" : "Request failed"}
                              aria-label={runDot.kind === "success" ? "Request succeeded" : "Request failed"}
                            >
                              ●
                            </span>
                          ) : null}

                          <button
                            type="button"
                            onClick={(event) => void handleRunClick(event, endpoint)}
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
      </div>

      <div className="border-t border-vscode-panelBorder px-2 py-1 text-[11px] text-vscode-descriptionFg">
        {selectedEndpoint ? `Selected: ${selectedEndpoint.name}` : "No endpoint selected"}
      </div>
    </div>
  );
}
