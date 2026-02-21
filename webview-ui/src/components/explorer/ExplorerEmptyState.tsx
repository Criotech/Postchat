import { FileCode } from "lucide-react";
import { vscode } from "../../vscode";

export function ExplorerEmptyState(): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-lg border border-vscode-panelBorder bg-vscode-inputBg/40 p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-vscode-panelBorder bg-vscode-editorBg text-vscode-descriptionFg">
          <FileCode size={22} aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold text-vscode-editorFg">No Collection Loaded</h2>
        <p className="mt-2 text-sm text-vscode-descriptionFg">
          Load a Postman collection or OpenAPI spec to explore your API
        </p>
        <button
          type="button"
          onClick={() => vscode.postMessage({ command: "loadCollection" })}
          className="mt-4 rounded bg-vscode-buttonBg px-3 py-1.5 text-sm font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
        >
          Load Collection
        </button>
      </div>
    </div>
  );
}
