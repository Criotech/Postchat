import { useCallback, useEffect, useRef } from "react";
import type { Message } from "../types";
import { useBridge } from "../lib/explorerBridge";
import { MessageBubble } from "./MessageBubble";
import { RequestResult } from "./RequestResult";
import type { ExecutableRequest, ExecutionResult } from "./RequestResult";
import { ThinkingBubble } from "./ThinkingBubble";
import type { ParsedCollection } from "../types/spec";

type MessageListProps = {
  messages: Message[];
  isThinking: boolean;
  executionResults: Record<
    string,
    { request: ExecutableRequest; result: ExecutionResult; endpointId?: string | null }
  >;
  pendingExecutionName: string | null;
  onRunRequest?: (method: string, url: string) => void;
  parsedCollection: ParsedCollection | null;
};

function normalizePath(path: string): string {
  const [withoutQuery] = path.split("?");
  const trimmed = withoutQuery.trim();
  if (trimmed === "/") {
    return "/";
  }
  return trimmed.replace(/\/+$/, "");
}

function splitPathSegments(path: string): string[] {
  return normalizePath(path)
    .split("/")
    .filter((segment) => segment.length > 0);
}

function endpointPathMatches(collectionPath: string, candidatePath: string): boolean {
  const normalizedCollectionPath = normalizePath(collectionPath);
  const normalizedCandidatePath = normalizePath(candidatePath);

  if (normalizedCollectionPath === normalizedCandidatePath) {
    return true;
  }

  const collectionSegments = splitPathSegments(normalizedCollectionPath);
  const candidateSegments = splitPathSegments(normalizedCandidatePath);
  if (collectionSegments.length !== candidateSegments.length) {
    return false;
  }

  for (let index = 0; index < collectionSegments.length; index += 1) {
    const collectionSegment = collectionSegments[index];
    const candidateSegment = candidateSegments[index];
    const isCollectionParam =
      (collectionSegment.startsWith("{") && collectionSegment.endsWith("}")) ||
      collectionSegment.startsWith(":");
    const isCandidateParam =
      (candidateSegment.startsWith("{") && candidateSegment.endsWith("}")) ||
      candidateSegment.startsWith(":");

    if (isCollectionParam || isCandidateParam) {
      continue;
    }
    if (collectionSegment !== candidateSegment) {
      return false;
    }
  }

  return true;
}

function getRequestPath(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("/")) {
    return normalizePath(trimmed);
  }

  try {
    return normalizePath(new URL(trimmed).pathname || "/");
  } catch {
    return null;
  }
}

export function MessageList({
  messages,
  isThinking,
  executionResults,
  pendingExecutionName,
  onRunRequest,
  parsedCollection
}: MessageListProps): JSX.Element {
  const { emit } = useBridge();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isThinking, executionResults]);

  const resolveEndpointId = useCallback(
    (request: ExecutableRequest, endpointId?: string | null): string | null => {
      if (!parsedCollection) {
        return null;
      }

      if (endpointId && parsedCollection.endpoints.some((endpoint) => endpoint.id === endpointId)) {
        return endpointId;
      }

      const requestPath = getRequestPath(request.url);
      if (!requestPath) {
        return null;
      }

      const requestMethod = request.method.toUpperCase();
      const match = parsedCollection.endpoints.find(
        (endpoint) =>
          endpoint.method === requestMethod && endpointPathMatches(endpoint.path, requestPath)
      );

      return match?.id ?? null;
    },
    [parsedCollection]
  );

  const handleViewInExplorer = useCallback(
    (request: ExecutableRequest, endpointId?: string | null) => {
      const resolvedEndpointId = resolveEndpointId(request, endpointId);
      if (resolvedEndpointId) {
        emit({ type: "highlightEndpoint", endpointId: resolvedEndpointId });
        return;
      }
      emit({ type: "switchToExplorer" });
    },
    [emit, resolveEndpointId]
  );

  return (
    <main className="flex-1 overflow-y-auto px-3 py-3">
      <div className="flex flex-col gap-3">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onRunRequest={onRunRequest}
            parsedCollection={parsedCollection}
          />
        ))}

        {pendingExecutionName ? (
          <div className="mr-auto max-w-[90%] rounded-lg border border-vscode-panelBorder bg-vscode-card px-3 py-2 text-sm text-vscode-editorFg opacity-70">
            Running <span className="font-bold">{pendingExecutionName}</span>...
          </div>
        ) : null}

        {Object.entries(executionResults).map(([name, { request, result, endpointId }]) => (
          <RequestResult
            key={name}
            request={request}
            result={result}
            onViewInExplorer={() => handleViewInExplorer(request, endpointId)}
          />
        ))}

        {isThinking ? <ThinkingBubble /> : null}
        <div ref={bottomRef} />
      </div>
    </main>
  );
}
