import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExecutionResult } from "../RequestResult";
import { useBridgeListener } from "../../hooks/useBridgeListener";
import { useBridge } from "../../lib/explorerBridge";
import type { ParsedCollection, ParsedEndpoint } from "../../types/spec";
import { CollectionSummary } from "./CollectionSummary";
import { EndpointDetail } from "./EndpointDetail";
import { EndpointSidebar } from "./EndpointSidebar";

type PostmanExplorerProps = {
  collection: ParsedCollection;
  onSendToAI?: (prompt: string) => void;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function PostmanExplorer({ collection, onSendToAI }: PostmanExplorerProps): JSX.Element {
  const { emit } = useBridge();

  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [containerWidth, setContainerWidth] = useState(0);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  const [focusSearchSignal, setFocusSearchSignal] = useState(0);
  const [clearSearchSignal, setClearSearchSignal] = useState(0);
  const [runResults, setRunResults] = useState<Map<string, ExecutionResult>>(() => new Map());
  const [runErrors, setRunErrors] = useState<Map<string, string>>(() => new Map());
  const [highlightedEndpointId, setHighlightedEndpointId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const isResizingRef = useRef(false);
  const highlightTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (collection.endpoints.length === 0) {
      setSelectedEndpointId(null);
      return;
    }

    setSelectedEndpointId((prev) => {
      if (prev && collection.endpoints.some((endpoint) => endpoint.id === prev)) {
        return prev;
      }
      return null;
    });
  }, [collection.endpoints]);

  useEffect(() => {
    setRunResults(new Map());
    setRunErrors(new Map());
    setHighlightedEndpointId(null);
  }, [collection.title]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  useBridgeListener(
    (event) => {
      switch (event.type) {
        case "executionComplete": {
          setRunResults((prev) => {
            const next = new Map(prev);
            next.set(event.endpointId, event.result);
            return next;
          });
          setRunErrors((prev) => {
            if (!prev.has(event.endpointId)) {
              return prev;
            }
            const next = new Map(prev);
            next.delete(event.endpointId);
            return next;
          });
          return;
        }
        case "executionError": {
          setRunErrors((prev) => {
            const next = new Map(prev);
            next.set(event.endpointId, event.error);
            return next;
          });
          setRunResults((prev) => {
            if (!prev.has(event.endpointId)) {
              return prev;
            }
            const next = new Map(prev);
            next.delete(event.endpointId);
            return next;
          });
          return;
        }
        case "highlightEndpoint": {
          const exists = collection.endpoints.some((endpoint) => endpoint.id === event.endpointId);
          if (!exists) {
            return;
          }

          setSelectedEndpointId(event.endpointId);
          setHighlightedEndpointId(event.endpointId);

          if (highlightTimerRef.current !== null) {
            window.clearTimeout(highlightTimerRef.current);
          }

          highlightTimerRef.current = window.setTimeout(() => {
            setHighlightedEndpointId((current) =>
              current === event.endpointId ? null : current
            );
            highlightTimerRef.current = null;
          }, 1000);
          return;
        }
        default:
          return;
      }
    },
    [collection.endpoints]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const selectedEndpoint = selectedEndpointId
        ? collection.endpoints.find((item) => item.id === selectedEndpointId) ?? null
        : null;
      const key = event.key.toLowerCase();
      const hasMetaModifier = event.metaKey || event.ctrlKey;
      const activeElement = document.activeElement;
      const detailRoot = document.querySelector<HTMLElement>("[data-postchat-endpoint-detail=\"true\"]");
      const detailFocused = Boolean(detailRoot && activeElement && detailRoot.contains(activeElement));

      if (hasMetaModifier && key === "f") {
        event.preventDefault();
        setFocusSearchSignal((prev) => prev + 1);
        return;
      }

      if (key === "escape") {
        if (sidebarSearchQuery.trim().length > 0) {
          event.preventDefault();
          setClearSearchSignal((prev) => prev + 1);
        } else if (selectedEndpointId) {
          event.preventDefault();
          setSelectedEndpointId(null);
        }
        return;
      }

      if (hasMetaModifier && key === "enter" && selectedEndpoint && detailFocused) {
        event.preventDefault();
        emit({ type: "runEndpoint", endpoint: selectedEndpoint });
        return;
      }

      if (hasMetaModifier && event.shiftKey && key === "a" && selectedEndpoint) {
        event.preventDefault();
        emit({ type: "askAboutEndpoint", endpoint: selectedEndpoint });
        emit({ type: "switchToChat" });
        return;
      }

      if (!selectedEndpoint || isEditableTarget(event.target)) {
        return;
      }

      if (key === "r") {
        event.preventDefault();
        emit({ type: "runEndpoint", endpoint: selectedEndpoint });
        return;
      }

      if (key === "a") {
        event.preventDefault();
        emit({ type: "askAboutEndpoint", endpoint: selectedEndpoint });
        emit({ type: "switchToChat" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collection.endpoints, emit, selectedEndpointId, sidebarSearchQuery]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(width);
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!isResizingRef.current || !containerRef.current) {
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const nextWidth = Math.min(Math.max(event.clientX - rect.left, 220), 460);
      setSidebarWidth(nextWidth);
    };

    const onMouseUp = () => {
      isResizingRef.current = false;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const selectedEndpoint = useMemo(() => {
    return collection.endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? null;
  }, [collection.endpoints, selectedEndpointId]);

  const isNarrow = containerWidth > 0 && containerWidth < 400;

  const handleSelectEndpoint = useCallback((endpoint: ParsedEndpoint) => {
    setSelectedEndpointId(endpoint.id);
  }, []);

  const handleRunEndpoint = useCallback(
    (endpoint: ParsedEndpoint) => {
      emit({ type: "runEndpoint", endpoint });
    },
    [emit]
  );

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col">
      <CollectionSummary collection={collection} compact={isNarrow} />

      <div className="min-h-0 flex-1 overflow-hidden">
        {isNarrow ? (
          <div className="h-full">
            {selectedEndpoint ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="border-b border-vscode-panelBorder px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedEndpointId(null)}
                    className="rounded px-1.5 py-0.5 text-xs text-vscode-linkFg hover:bg-vscode-listHover"
                  >
                    ← Back
                  </button>
                </div>
                <EndpointDetail
                  endpoint={selectedEndpoint}
                  liveResult={runResults.get(selectedEndpoint.id) ?? null}
                  liveError={runErrors.get(selectedEndpoint.id) ?? null}
                  onSendToAI={onSendToAI}
                />
              </div>
            ) : (
              <EndpointSidebar
                endpoints={collection.endpoints}
                selectedId={selectedEndpointId}
                selectedEndpoint={selectedEndpoint}
                onSelect={handleSelectEndpoint}
                onRunRequest={handleRunEndpoint}
                runResults={runResults}
                runErrors={runErrors}
                highlightedEndpointId={highlightedEndpointId}
                focusSearchSignal={focusSearchSignal}
                clearSearchSignal={clearSearchSignal}
                onSearchQueryChange={setSidebarSearchQuery}
                onEscapeNoSearch={() => setSelectedEndpointId(null)}
              />
            )}
          </div>
        ) : (
          <div
            className="grid h-full min-h-0"
            style={{ gridTemplateColumns: `${sidebarWidth}px 6px minmax(0, 1fr)` }}
          >
            <div className="min-h-0 overflow-hidden border-r border-vscode-panelBorder">
              <EndpointSidebar
                endpoints={collection.endpoints}
                selectedId={selectedEndpointId}
                selectedEndpoint={selectedEndpoint}
                onSelect={handleSelectEndpoint}
                onRunRequest={handleRunEndpoint}
                runResults={runResults}
                runErrors={runErrors}
                highlightedEndpointId={highlightedEndpointId}
                focusSearchSignal={focusSearchSignal}
                clearSearchSignal={clearSearchSignal}
                onSearchQueryChange={setSidebarSearchQuery}
                onEscapeNoSearch={() => setSelectedEndpointId(null)}
              />
            </div>

            <div
              className="cursor-col-resize bg-vscode-panelBorder/70 hover:bg-vscode-focusBorder"
              onMouseDown={() => {
                isResizingRef.current = true;
              }}
              aria-label="Resize endpoint sidebar"
              role="separator"
            />

            <div className="min-h-0 overflow-hidden">
              <EndpointDetail
                endpoint={selectedEndpoint}
                liveResult={selectedEndpoint ? runResults.get(selectedEndpoint.id) ?? null : null}
                liveError={selectedEndpoint ? runErrors.get(selectedEndpoint.id) ?? null : null}
                onSendToAI={onSendToAI}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
