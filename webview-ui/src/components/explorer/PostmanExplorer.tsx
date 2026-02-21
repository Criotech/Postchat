import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExecutionResult } from "../RequestResult";
import { useBridgeListener } from "../../hooks/useBridgeListener";
import { useBridge } from "../../lib/explorerBridge";
import type { ParsedCollection, ParsedEndpoint } from "../../types/spec";
import { CollectionSummary } from "./CollectionSummary";
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

function upsertRecentOpened(
  previous: ParsedEndpoint[],
  endpoint: ParsedEndpoint,
  allEndpoints: ParsedEndpoint[]
): ParsedEndpoint[] {
  const byId = new Map(allEndpoints.map((item) => [item.id, item] as const));
  const next = [endpoint, ...previous.filter((item) => item.id !== endpoint.id)]
    .map((item) => byId.get(item.id) ?? item)
    .slice(0, 5);

  return next;
}

export function PostmanExplorer({ collection, onSendToAI: _onSendToAI }: PostmanExplorerProps): JSX.Element {
  const { emit } = useBridge();

  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  const [focusSearchSignal, setFocusSearchSignal] = useState(0);
  const [clearSearchSignal, setClearSearchSignal] = useState(0);
  const [runResults, setRunResults] = useState<Map<string, ExecutionResult>>(() => new Map());
  const [runErrors, setRunErrors] = useState<Map<string, string>>(() => new Map());
  const [highlightedEndpointId, setHighlightedEndpointId] = useState<string | null>(null);
  const [recentlyOpened, setRecentlyOpened] = useState<ParsedEndpoint[]>([]);

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
    setRecentlyOpened([]);
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

  const selectedEndpoint = useMemo(() => {
    return collection.endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? null;
  }, [collection.endpoints, selectedEndpointId]);

  const handleRunEndpoint = useCallback(
    (endpoint: ParsedEndpoint) => {
      emit({ type: "runEndpoint", endpoint });
    },
    [emit]
  );

  const handleOpenRequestTab = useCallback(
    (endpoint: ParsedEndpoint) => {
      setSelectedEndpointId(endpoint.id);
      setRecentlyOpened((prev) => upsertRecentOpened(prev, endpoint, collection.endpoints));
    },
    [collection.endpoints]
  );

  const handleReopenRecent = useCallback(
    (endpoint: ParsedEndpoint) => {
      setSelectedEndpointId(endpoint.id);
      setRecentlyOpened((prev) => upsertRecentOpened(prev, endpoint, collection.endpoints));
    },
    [collection.endpoints]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const hasMetaModifier = event.metaKey || event.ctrlKey;

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

      const selected = selectedEndpoint;
      if (!selected || isEditableTarget(event.target)) {
        return;
      }

      if (hasMetaModifier && key === "enter") {
        event.preventDefault();
        emit({ type: "runEndpoint", endpoint: selected });
        return;
      }

      if (hasMetaModifier && event.shiftKey && key === "a") {
        event.preventDefault();
        emit({ type: "askAboutEndpoint", endpoint: selected });
        emit({ type: "switchToChat" });
        return;
      }

      if (key === "r") {
        event.preventDefault();
        emit({ type: "runEndpoint", endpoint: selected });
        return;
      }

      if (key === "a") {
        event.preventDefault();
        emit({ type: "askAboutEndpoint", endpoint: selected });
        emit({ type: "switchToChat" });
        return;
      }

    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collection.endpoints, emit, selectedEndpoint, selectedEndpointId, sidebarSearchQuery]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CollectionSummary collection={collection} />

      <div className="min-h-0 flex-1 overflow-hidden border-t border-vscode-panelBorder">
        <EndpointSidebar
          endpoints={collection.endpoints}
          selectedId={selectedEndpointId}
          onSelect={(endpoint) => setSelectedEndpointId(endpoint.id)}
          onOpenRequestTab={handleOpenRequestTab}
          onRunRequest={handleRunEndpoint}
          runResults={runResults}
          runErrors={runErrors}
          highlightedEndpointId={highlightedEndpointId}
          focusSearchSignal={focusSearchSignal}
          clearSearchSignal={clearSearchSignal}
          onSearchQueryChange={setSidebarSearchQuery}
          onEscapeNoSearch={() => setSelectedEndpointId(null)}
          recentlyOpened={recentlyOpened}
          onReopenRecent={handleReopenRecent}
        />
      </div>
    </div>
  );
}
