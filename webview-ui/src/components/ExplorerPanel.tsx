import type { ParsedCollection, SpecType } from "../types/spec";
import { ExplorerEmptyState } from "./explorer/ExplorerEmptyState";
import { PostmanExplorer } from "./explorer/PostmanExplorer";
import { StoplightExplorer } from "./explorer/StoplightExplorer";

type ExplorerPanelProps = {
  parsedCollection: ParsedCollection | null;
  rawSpec: string | null;
  specType: SpecType | null;
  onSendToAI: (prompt: string) => void;
};

export function ExplorerPanel({
  parsedCollection,
  rawSpec,
  specType,
  onSendToAI
}: ExplorerPanelProps): JSX.Element {
  let content: JSX.Element;

  if (!parsedCollection) {
    content = <ExplorerEmptyState />;
  } else if (specType === "postman") {
    content = (
      <PostmanExplorer
        collection={parsedCollection}
        onSendToAI={onSendToAI}
      />
    );
  } else if (specType === "openapi3" || specType === "swagger2") {
    content = (
      <StoplightExplorer
        rawSpec={rawSpec ?? ""}
        specType={specType}
        parsedCollection={parsedCollection}
      />
    );
  } else {
    content = <ExplorerEmptyState />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--vscode-editor-background)]">
      {content}
    </div>
  );
}
