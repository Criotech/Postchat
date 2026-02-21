import { useCallback, useMemo, useState } from "react";
import type { ParsedCollection } from "../../types/spec";

type CollectionSummaryProps = {
  collection: ParsedCollection | null;
  compact?: boolean;
};

function getAuthSummary(collection: ParsedCollection): string {
  if (collection.authSchemes.length === 0) {
    return "No auth";
  }

  const first = collection.authSchemes[0];
  return first.type ? first.type.toUpperCase() : first.name || "Auth";
}

function getFolderCount(collection: ParsedCollection): number {
  const folders = new Set<string>();
  for (const endpoint of collection.endpoints) {
    folders.add(endpoint.folder || "General");
  }
  return folders.size;
}

function getSpecBadge(collection: ParsedCollection): { label: string; className: string } {
  if (collection.specType === "postman") {
    return {
      label: "Postman",
      className: "border-orange-600/40 bg-orange-600/20 text-orange-300"
    };
  }

  if (collection.specType === "openapi3") {
    return {
      label: "OpenAPI 3.0",
      className: "border-green-600/40 bg-green-600/20 text-green-300"
    };
  }

  return {
    label: "Swagger 2.0",
    className: "border-blue-600/40 bg-blue-600/20 text-blue-300"
  };
}

export function CollectionSummary({ collection, compact = false }: CollectionSummaryProps): JSX.Element | null {
  const [copied, setCopied] = useState(false);

  const summary = useMemo(() => {
    if (!collection) {
      return null;
    }

    return {
      title: collection.title,
      endpointCount: collection.endpoints.length,
      folderCount: getFolderCount(collection),
      authType: getAuthSummary(collection),
      baseUrl: collection.baseUrl || "(no base URL)"
    };
  }, [collection]);

  const handleCopyBaseUrl = useCallback(async () => {
    if (!summary || !summary.baseUrl || summary.baseUrl === "(no base URL)") {
      return;
    }

    await navigator.clipboard.writeText(summary.baseUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [summary]);

  if (!summary) {
    return null;
  }

  if (!collection) {
    return null;
  }

  const specBadge = getSpecBadge(collection);

  return (
    <div className="border-b border-vscode-panelBorder bg-vscode-inputBg/40 px-3 py-2 text-xs text-vscode-descriptionFg">
      <div className="flex min-w-0 items-center gap-2">
        <span className={["rounded border px-1.5 py-0.5 text-[10px] font-semibold", specBadge.className].join(" ")}>
          {specBadge.label}
        </span>

        {compact ? (
          <span className="text-vscode-descriptionFg">{summary.endpointCount} endpoints</span>
        ) : collection.specType === "postman" ? (
          <>
            <span className="truncate font-medium text-vscode-editorFg">{summary.title}</span>
            <span className="opacity-70">·</span>
            <span>{summary.endpointCount} endpoints</span>
            <span className="opacity-70">·</span>
            <span>{summary.folderCount} folders</span>
            <span className="opacity-70">·</span>
            <span>{summary.authType}</span>
          </>
        ) : (
          <>
            <span className="truncate font-medium text-vscode-editorFg">
              {summary.title}
              {collection.version ? ` v${collection.version}` : ""}
            </span>
            <span className="opacity-70">·</span>
            <span>{summary.endpointCount} operations</span>
            <span className="opacity-70">·</span>
            <span>{collection.specType === "openapi3" ? "OpenAPI 3.0" : "Swagger 2.0"}</span>
            <span className="opacity-70">·</span>
            <button
              type="button"
              onClick={handleCopyBaseUrl}
              className="max-w-[40%] truncate align-bottom text-vscode-linkFg underline decoration-dotted underline-offset-2"
              title={copied ? "Copied!" : `Copy base URL: ${summary.baseUrl}`}
            >
              {summary.baseUrl}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
