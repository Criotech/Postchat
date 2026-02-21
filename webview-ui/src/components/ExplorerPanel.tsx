import type { ExecutionResult } from "./RequestResult";
import type { ParsedCollection, ParsedEndpoint, SpecType } from "../types/spec";
import { ExplorerEmptyState } from "./explorer/ExplorerEmptyState";
import { PostmanExplorer } from "./explorer/PostmanExplorer";
import { StoplightExplorer } from "./explorer/StoplightExplorer";

type ExplorerPanelProps = {
  parsedCollection: ParsedCollection | null;
  rawSpec: string | null;
  specType: SpecType | null;
  onRunRequest: (
    endpoint: ParsedEndpoint
  ) => Promise<ExecutionResult | null> | ExecutionResult | null | void;
  onAskAI: (endpoint: ParsedEndpoint) => void;
  onSendToAI: (prompt: string) => void;
};

export function ExplorerPanel({
  parsedCollection,
  rawSpec,
  specType,
  onRunRequest,
  onAskAI,
  onSendToAI
}: ExplorerPanelProps): JSX.Element {
  let content: JSX.Element;

  if (!parsedCollection) {
    content = <ExplorerEmptyState />;
  } else if (specType === "postman") {
    content = (
      <PostmanExplorer
        collection={parsedCollection}
        onRunRequest={onRunRequest}
        onAskAI={onAskAI}
        onSendToAI={onSendToAI}
      />
    );
  } else if (specType === "openapi3" || specType === "swagger2") {
    content = <StoplightExplorer rawSpec={rawSpec} specType={specType} />;
  } else {
    content = <ExplorerEmptyState />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--vscode-editor-background)]">
      {content}
    </div>
  );
}
