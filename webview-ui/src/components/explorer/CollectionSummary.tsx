import { useCallback, useMemo, useState } from "react";
import { Copy, Check } from "lucide-react";
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

function Separator() {
  return (
    <span
      className="mx-0.5 inline-block h-3 w-px shrink-0"
      style={{ background: "var(--vscode-panelSection-border, rgba(128,128,128,0.25))" }}
      aria-hidden="true"
    />
  );
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
    <div className="border-b border-vscode-panelBorder px-3 py-2 text-[11px] text-vscode-descriptionFg">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={["shrink-0 rounded-full border px-2 py-[1px] text-[10px] font-semibold", specBadge.className].join(" ")}>
          {specBadge.label}
        </span>

        {compact ? (
          <span className="text-vscode-descriptionFg">{summary.endpointCount} endpoints</span>
        ) : collection.specType === "postman" ? (
          <>
            <span className="truncate font-medium text-vscode-editorFg">{summary.title}</span>
            <Separator />
            <span className="shrink-0">{summary.endpointCount} endpoints</span>
            <Separator />
            <span className="shrink-0">{summary.folderCount} folders</span>
            <Separator />
            <span className="shrink-0">{summary.authType}</span>
          </>
        ) : (
          <>
            <span className="truncate font-medium text-vscode-editorFg">
              {summary.title}
              {collection.version ? ` v${collection.version}` : ""}
            </span>
            <Separator />
            <span className="shrink-0">{summary.endpointCount} operations</span>
            <Separator />
            <span className="shrink-0">{collection.specType === "openapi3" ? "OpenAPI 3.0" : "Swagger 2.0"}</span>
            <Separator />
            <button
              type="button"
              onClick={handleCopyBaseUrl}
              className="group/copy inline-flex max-w-[40%] items-center gap-1 truncate text-vscode-linkFg hover:underline"
              title={copied ? "Copied!" : `Copy base URL: ${summary.baseUrl}`}
            >
              <span className="truncate">{summary.baseUrl}</span>
              {copied ? (
                <Check size={11} className="shrink-0 text-green-400" />
              ) : (
                <Copy size={10} className="shrink-0 opacity-0 group-hover/copy:opacity-100" />
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
