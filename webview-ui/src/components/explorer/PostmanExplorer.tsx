import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExecutionResult } from "../RequestResult";
import type { ParsedCollection, ParsedEndpoint } from "../../types/spec";
import { vscode } from "../../vscode";
import { CollectionSummary } from "./CollectionSummary";
import { EndpointDetail } from "./EndpointDetail";
import { EndpointSidebar } from "./EndpointSidebar";

type PostmanExplorerProps = {
  collection: ParsedCollection;
  onRunRequest: (
    endpoint: ParsedEndpoint
  ) => Promise<ExecutionResult | null> | ExecutionResult | null | void;
  onAskAI: (endpoint: ParsedEndpoint) => void;
  onSendToAI?: (prompt: string) => void;
};

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value;
}

export function PostmanExplorer({
  collection,
  onRunRequest,
  onAskAI,
  onSendToAI
}: PostmanExplorerProps): JSX.Element {
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [containerWidth, setContainerWidth] = useState(0);
  const [liveResultsByEndpointId, setLiveResultsByEndpointId] = useState<Record<string, ExecutionResult>>({});
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isResizingRef = useRef(false);

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
    setLiveResultsByEndpointId({});
  }, [collection.title]);

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

  const isNarrow = containerWidth > 0 && containerWidth < 500;

  const handleSelectEndpoint = useCallback((endpoint: ParsedEndpoint) => {
    setSelectedEndpointId(endpoint.id);
  }, []);

  const handleRunEndpoint = useCallback(
    async (endpoint: ParsedEndpoint): Promise<ExecutionResult | null> => {
      vscode.postMessage({
        command: "runEndpoint",
        endpointId: endpoint.id,
        endpointName: endpoint.name,
        method: endpoint.method,
        url: endpoint.url
      });

      const maybeResult = onRunRequest(endpoint);
      let result: ExecutionResult | null | undefined;

      if (isPromiseLike<ExecutionResult | null>(maybeResult)) {
        result = await maybeResult;
      } else {
        result = maybeResult;
      }

      if (result) {
        setLiveResultsByEndpointId((prev) => ({
          ...prev,
          [endpoint.id]: result
        }));
      }

      return result ?? null;
    },
    [onRunRequest]
  );

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col">
      <CollectionSummary collection={collection} />

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
                  onAskAI={onAskAI}
                  onRunRequest={handleRunEndpoint}
                  liveResult={liveResultsByEndpointId[selectedEndpoint.id] ?? null}
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
                onAskAI={onAskAI}
                onRunRequest={handleRunEndpoint}
                liveResult={selectedEndpoint ? liveResultsByEndpointId[selectedEndpoint.id] ?? null : null}
                onSendToAI={onSendToAI}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
