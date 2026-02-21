import type { ParsedCollection, SpecType } from "../types/spec";
import { ExplorerEmptyState } from "./explorer/ExplorerEmptyState";
import { PostmanExplorer } from "./explorer/PostmanExplorer";
import { StoplightExplorer } from "./explorer/StoplightExplorer";

type ExplorerPanelProps = {
  parsedCollection: ParsedCollection | null;
  rawSpec: string | null;
  specType: SpecType | null;
};

export function ExplorerPanel({
  parsedCollection,
  rawSpec,
  specType
}: ExplorerPanelProps): JSX.Element {
  let content: JSX.Element;

  if (!parsedCollection) {
    content = <ExplorerEmptyState />;
  } else if (specType === "postman") {
    content = <PostmanExplorer collection={parsedCollection} />;
  } else if (specType === "openapi3" || specType === "swagger2") {
    content = <StoplightExplorer rawSpec={rawSpec} specType={specType} />;
  } else {
    content = <ExplorerEmptyState />;
  }

  return <div className="h-full overflow-hidden flex flex-col bg-[var(--vscode-editor-background)]">{content}</div>;
}
