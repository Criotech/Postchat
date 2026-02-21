import { API } from "@stoplight/elements";
import "@stoplight/elements/styles.min.css";
import type { SpecType } from "../../types/spec";

type StoplightExplorerProps = {
  rawSpec: string | null;
  specType: Extract<SpecType, "openapi3" | "swagger2">;
};

export function StoplightExplorer({ rawSpec, specType }: StoplightExplorerProps): JSX.Element {
  if (!rawSpec) {
    return (
      <div className="m-3 rounded border border-vscode-errorBorder bg-vscode-errorBg px-3 py-2 text-sm text-vscode-errorFg">
        Could not render this {specType === "openapi3" ? "OpenAPI" : "Swagger"} document because
        the raw specification is unavailable.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <API apiDescriptionDocument={rawSpec} router="hash" hideTryIt />
    </div>
  );
}
