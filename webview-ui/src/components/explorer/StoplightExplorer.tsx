import { API } from "@stoplight/elements";
import "@stoplight/elements/styles.min.css";
import yaml from "js-yaml";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExecutionResult } from "../RequestResult";
import type { ParsedCollection, ParsedEndpoint, SpecType } from "../../types/spec";
import { FloatingActionBar } from "./FloatingActionBar";

type StoplightExplorerProps = {
  rawSpec: string;
  specType: Extract<SpecType, "openapi3" | "swagger2">;
  parsedCollection: ParsedCollection;
  onRunRequest: (
    endpoint: ParsedEndpoint
  ) => Promise<ExecutionResult | null> | ExecutionResult | null | void;
  onAskAI: (endpoint: ParsedEndpoint) => void;
};

const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeStoplightPath(encodedPath: string): string {
  const decoded = decodeURIComponent(encodedPath).replace(/~1/g, "/").replace(/~0/g, "~");
  return decoded.startsWith("/") ? decoded : `/${decoded}`;
}

export function StoplightExplorer({
  rawSpec,
  specType,
  parsedCollection,
  onRunRequest,
  onAskAI
}: StoplightExplorerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const [selectedOperation, setSelectedOperation] = useState<ParsedEndpoint | null>(null);
  const [runResult, setRunResult] = useState<ExecutionResult | null>(null);

  const parsedSpec = useMemo<Record<string, unknown> | null>(() => {
    const trimmed = rawSpec.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      return isObject(parsed) ? parsed : null;
    } catch {
      try {
        const parsedYaml = yaml.load(trimmed);
        return isObject(parsedYaml) ? parsedYaml : null;
      } catch {
        return null;
      }
    }
  }, [rawSpec]);

  const operationLookup = useMemo(() => {
    const lookup = new Map<string, { path: string; method: ParsedEndpoint["method"] }>();

    if (!parsedSpec || !isObject(parsedSpec.paths)) {
      return lookup;
    }

    for (const [pathKey, rawPathItem] of Object.entries(parsedSpec.paths)) {
      if (!isObject(rawPathItem)) {
        continue;
      }

      for (const [rawMethod, rawOperation] of Object.entries(rawPathItem)) {
        if (!METHODS.has(rawMethod.toLowerCase()) || !isObject(rawOperation)) {
          continue;
        }

        const operationId =
          typeof rawOperation.operationId === "string" ? rawOperation.operationId.trim() : "";
        if (!operationId) {
          continue;
        }

        lookup.set(operationId, {
          path: pathKey,
          method: rawMethod.toUpperCase() as ParsedEndpoint["method"]
        });
      }
    }

    return lookup;
  }, [parsedSpec]);

  const handleHashChange = useCallback(() => {
    const hash = window.location.hash || "";
    const endpoints = parsedCollection.endpoints;

    if (!hash.startsWith("#/")) {
      setSelectedOperationId(null);
      setSelectedOperation(null);
      return;
    }

    const operationMatch = hash.match(/^#\/operations\/([^/?#]+)/);
    if (operationMatch) {
      const operationToken = decodeURIComponent(operationMatch[1] ?? "").trim();
      const operationByNameOrId =
        endpoints.find((endpoint) => endpoint.id === operationToken || endpoint.name === operationToken) ??
        null;

      const operationFromSpec = operationLookup.get(operationToken);
      const operationByPathAndMethod =
        operationFromSpec
          ? endpoints.find(
              (endpoint) =>
                endpoint.path === operationFromSpec.path && endpoint.method === operationFromSpec.method
            ) ?? null
          : null;

      const matched = operationByNameOrId ?? operationByPathAndMethod;
      const nextSelectedId = matched?.id ?? operationToken ?? null;
      setSelectedOperationId(nextSelectedId);
      setSelectedOperation(matched);
      return;
    }

    const pathMatch = hash.match(
      /^#\/paths\/(.+?)\/(get|post|put|patch|delete|head|options)(?:\/.*)?$/i
    );
    if (pathMatch) {
      const decodedPath = decodeStoplightPath(pathMatch[1] ?? "");
      const method = (pathMatch[2] ?? "").toUpperCase() as ParsedEndpoint["method"];
      const matched =
        endpoints.find((endpoint) => endpoint.path === decodedPath && endpoint.method === method) ?? null;
      setSelectedOperationId(matched?.id ?? `${method} ${decodedPath}`);
      setSelectedOperation(matched);
      return;
    }

    setSelectedOperationId(null);
    setSelectedOperation(null);
  }, [operationLookup, parsedCollection.endpoints]);

  useEffect(() => {
    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [handleHashChange]);

  useEffect(() => {
    setRunResult(null);
  }, [selectedOperationId]);

  const handleRun = useCallback(async () => {
    if (!selectedOperation) {
      return;
    }

    const maybeResult = onRunRequest(selectedOperation);

    if (isPromiseLike<ExecutionResult | null>(maybeResult)) {
      const result = await maybeResult;
      setRunResult(result ?? null);
      return;
    }

    setRunResult(maybeResult ?? null);
  }, [onRunRequest, selectedOperation]);

  const handleAskAI = useCallback(() => {
    if (!selectedOperation) {
      return;
    }

    onAskAI(selectedOperation);
  }, [onAskAI, selectedOperation]);

  if (!parsedSpec) {
    return (
      <div className="m-3 rounded border border-vscode-errorBorder bg-vscode-errorBg px-3 py-2 text-sm text-vscode-errorFg">
        Could not parse the specification file. Check that it is valid JSON or YAML.
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      <div ref={containerRef} className="postchat-stoplight-wrapper flex-1 overflow-auto pb-24">
        <API
          apiDescriptionDocument={parsedSpec}
          router="hash"
          layout="sidebar"
          hideExport={true}
          tryItCredentialsPolicy="same-origin"
        />
      </div>

      {selectedOperation ? (
        <FloatingActionBar
          endpoint={selectedOperation}
          runResult={runResult}
          onRunRequest={handleRun}
          onAskAI={handleAskAI}
          onClearResult={() => setRunResult(null)}
        />
      ) : null}
    </div>
  );
}
