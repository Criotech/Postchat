import { Component, Suspense, lazy } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { ParsedCollection, SpecType } from "../types/spec";
import { ExplorerEmptyState } from "./explorer/ExplorerEmptyState";
import { PostmanExplorer } from "./explorer/PostmanExplorer";

const LazyStoplightExplorer = lazy(async () => {
  const module = await import("./explorer/StoplightExplorer");
  return { default: module.StoplightExplorer };
});

class StoplightExplorerErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  override state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, _errorInfo: ErrorInfo): void {
    console.error("Stoplight explorer failed to render", error);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="m-3 rounded border border-vscode-errorBorder bg-vscode-errorBg px-3 py-2 text-sm text-vscode-errorFg">
          Explorer failed to load for this API spec. You can still use Chat and Postman explorer features.
        </div>
      );
    }

    return this.props.children;
  }
}

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
      <StoplightExplorerErrorBoundary>
        <Suspense
          fallback={
            <div className="m-3 rounded border border-vscode-border bg-vscode-editorWidgetBg px-3 py-2 text-sm text-vscode-descriptionFg">
              Loading OpenAPI explorer...
            </div>
          }
        >
          <LazyStoplightExplorer
            rawSpec={rawSpec ?? ""}
            specType={specType}
            parsedCollection={parsedCollection}
          />
        </Suspense>
      </StoplightExplorerErrorBoundary>
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
