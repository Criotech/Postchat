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
  { children: ReactNode; rawSpec: string | null },
  { hasError: boolean; showRawSpec: boolean }
> {
  override state = { hasError: false, showRawSpec: false };

  static getDerivedStateFromError(): { hasError: boolean; showRawSpec: boolean } {
    return { hasError: true, showRawSpec: false };
  }

  override componentDidCatch(error: Error, _errorInfo: ErrorInfo): void {
    console.error("Stoplight explorer failed to render", error);
  }

  override componentDidUpdate(prevProps: { children: ReactNode; rawSpec: string | null }): void {
    if (prevProps.rawSpec !== this.props.rawSpec && this.state.hasError) {
      this.setState({ hasError: false, showRawSpec: false });
    }
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="m-3 rounded border border-vscode-errorBorder bg-vscode-errorBg/60 p-3 text-sm text-vscode-errorFg">
          <p>Could not render this spec. The file may have validation errors.</p>
          <button
            type="button"
            onClick={() => this.setState((prev) => ({ ...prev, showRawSpec: !prev.showRawSpec }))}
            className="mt-2 rounded bg-vscode-buttonBg px-2 py-1 text-xs font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover"
          >
            {this.state.showRawSpec ? "Hide Raw Spec" : "View Raw Spec"}
          </button>

          {this.state.showRawSpec && this.props.rawSpec ? (
            <pre className="mt-3 max-h-[50vh] overflow-auto rounded border border-vscode-panelBorder bg-vscode-editorBg p-2 font-mono text-[11px] text-vscode-editorFg">
              <code>{this.props.rawSpec}</code>
            </pre>
          ) : null}
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
  isParsing?: boolean;
};

export function ExplorerPanel({
  parsedCollection,
  rawSpec,
  specType,
  onSendToAI,
  isParsing = false
}: ExplorerPanelProps): JSX.Element {
  let content: JSX.Element;

  if (isParsing) {
    content = (
      <div className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] gap-3 p-3">
        <div className="rounded border border-vscode-panelBorder bg-vscode-inputBg/40 p-3">
          <div className="mb-3 h-6 w-3/4 animate-pulse rounded bg-vscode-listHover" />
          <div className="space-y-2">
            <div className="h-10 animate-pulse rounded bg-vscode-listHover" />
            <div className="h-10 animate-pulse rounded bg-vscode-listHover" />
            <div className="h-10 animate-pulse rounded bg-vscode-listHover" />
          </div>
        </div>
        <div className="rounded border border-vscode-panelBorder bg-vscode-inputBg/40 p-3">
          <div className="h-64 animate-pulse rounded bg-vscode-listHover" />
        </div>
      </div>
    );
  } else if (!parsedCollection) {
    content = <ExplorerEmptyState />;
  } else if (parsedCollection.endpoints.length === 0) {
    content = (
      <div className="m-3 rounded border border-vscode-panelBorder bg-vscode-inputBg/40 p-4 text-sm text-vscode-descriptionFg">
        <p className="font-medium text-vscode-editorFg">No endpoints found in this collection</p>
        <p className="mt-1">
          Make sure the file is a valid Postman collection or OpenAPI/Swagger spec with at least one path.
        </p>
        <a
          href="https://learning.postman.com/docs/getting-started/importing-and-exporting/importing-data/"
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-vscode-linkFg underline"
        >
          View expected format docs
        </a>
      </div>
    );
  } else if (specType === "postman") {
    content = (
      <PostmanExplorer
        collection={parsedCollection}
        onSendToAI={onSendToAI}
      />
    );
  } else if (specType === "openapi3" || specType === "swagger2") {
    content = (
      <StoplightExplorerErrorBoundary rawSpec={rawSpec}>
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
