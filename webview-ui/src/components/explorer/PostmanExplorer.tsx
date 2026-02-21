import { vscode } from "../../vscode";
import type { ParsedCollection, ParsedEndpoint } from "../../types/spec";

type PostmanExplorerProps = {
  collection: ParsedCollection;
};

const METHOD_STYLES: Record<ParsedEndpoint["method"], string> = {
  GET: "bg-emerald-600/20 text-emerald-300",
  POST: "bg-blue-600/20 text-blue-300",
  PUT: "bg-amber-600/20 text-amber-300",
  PATCH: "bg-violet-600/20 text-violet-300",
  DELETE: "bg-rose-600/20 text-rose-300",
  HEAD: "bg-cyan-600/20 text-cyan-300",
  OPTIONS: "bg-slate-600/20 text-slate-300"
};

function groupByFolder(endpoints: ParsedEndpoint[]): Array<[string, ParsedEndpoint[]]> {
  const folderMap = new Map<string, ParsedEndpoint[]>();
  for (const endpoint of endpoints) {
    const folderName = endpoint.folder || "General";
    const existing = folderMap.get(folderName);
    if (existing) {
      existing.push(endpoint);
    } else {
      folderMap.set(folderName, [endpoint]);
    }
  }
  return Array.from(folderMap.entries());
}

export function PostmanExplorer({ collection }: PostmanExplorerProps): JSX.Element {
  const folders = groupByFolder(collection.endpoints);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-vscode-panelBorder px-4 py-3">
        <h2 className="text-sm font-semibold text-vscode-editorFg">{collection.title}</h2>
        <p className="mt-1 text-xs text-vscode-descriptionFg">
          {collection.endpoints.length} endpoints
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="flex flex-col gap-3">
          {folders.map(([folder, endpoints]) => (
            <section key={folder} className="rounded-md border border-vscode-panelBorder bg-vscode-inputBg/40">
              <div className="border-b border-vscode-panelBorder px-3 py-2 text-xs font-semibold uppercase tracking-wide text-vscode-descriptionFg">
                {folder}
              </div>
              <ul className="divide-y divide-vscode-panelBorder">
                {endpoints.map((endpoint) => (
                  <li key={endpoint.id} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={[
                              "inline-flex min-w-[64px] items-center justify-center rounded px-2 py-0.5 text-[11px] font-bold",
                              METHOD_STYLES[endpoint.method]
                            ].join(" ")}
                          >
                            {endpoint.method}
                          </span>
                          <span className="truncate text-sm text-vscode-editorFg">{endpoint.name}</span>
                        </div>
                        <p className="mt-1 truncate text-xs text-vscode-descriptionFg" title={endpoint.url}>
                          {endpoint.url}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          vscode.postMessage({
                            command: "executeRequestByEndpoint",
                            method: endpoint.method,
                            url: endpoint.url
                          })
                        }
                        className="shrink-0 rounded border border-vscode-inputBorder bg-vscode-inputBg px-2 py-1 text-xs text-vscode-inputFg hover:bg-vscode-listHover focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
                      >
                        Run
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
