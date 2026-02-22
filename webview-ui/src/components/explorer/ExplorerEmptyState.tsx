import { FileCode } from "lucide-react";
import { vscode } from "../../vscode";

export function ExplorerEmptyState(): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-xs text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg text-vscode-descriptionFg"
          style={{ background: "var(--vscode-editorWidget-background)" }}
        >
          <FileCode size={24} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <h2 className="text-sm font-semibold text-vscode-editorFg">No Collection Loaded</h2>
        <p className="mt-1.5 text-xs text-vscode-descriptionFg">
          Load a Postman collection or OpenAPI spec to explore your API
        </p>
        <button
          type="button"
          onClick={() => vscode.postMessage({ command: "loadCollection" })}
          className="mt-4 rounded bg-vscode-buttonBg px-4 py-1.5 text-xs font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
        >
          Load Collection
        </button>
      </div>
    </div>
  );
}
