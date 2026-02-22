import { useCallback, useMemo, useRef, useState } from "react";
import { useClickOutside } from "../hooks/useClickOutside";

type CollectionSpecType = "postman" | "openapi3" | "swagger2";

type CollectionItem = {
  id: string;
  name: string;
  specType: CollectionSpecType;
  envName?: string;
};

type CollectionSwitcherProps = {
  collections: CollectionItem[];
  activeCollectionId: string;
  onSwitchCollection: (id: string) => void;
  onRemoveCollection: (id: string) => void;
  onLoadCollection: () => void;
};

function getSpecIcon(specType: CollectionSpecType): string {
  if (specType === "postman") {
    return "📦";
  }
  if (specType === "swagger2") {
    return "📘";
  }
  return "📄";
}

function getSpecBadge(specType: CollectionSpecType): string {
  if (specType === "postman") {
    return "Postman";
  }
  if (specType === "swagger2") {
    return "Swagger";
  }
  return "OpenAPI";
}

export function CollectionSwitcher({
  collections,
  activeCollectionId,
  onSwitchCollection,
  onRemoveCollection,
  onLoadCollection
}: CollectionSwitcherProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeCollection = useMemo(
    () => collections.find((item) => item.id === activeCollectionId) ?? null,
    [activeCollectionId, collections]
  );

  useClickOutside(containerRef, () => setIsOpen(false), isOpen);

  const handleSwitch = useCallback(
    (id: string) => {
      setIsOpen(false);
      onSwitchCollection(id);
    },
    [onSwitchCollection]
  );

  if (!activeCollection) {
    return (
      <button
        type="button"
        onClick={onLoadCollection}
        className="rounded bg-vscode-buttonBg px-2.5 py-1.5 text-xs font-medium text-vscode-buttonFg hover:bg-vscode-buttonHover focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
      >
        Load Collection
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-[360px]">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 rounded border border-vscode-inputBorder bg-vscode-inputBg px-2.5 py-1.5 text-left text-xs text-vscode-inputFg hover:bg-vscode-listHover focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
      >
        <span className="truncate">
          {getSpecIcon(activeCollection.specType)} {activeCollection.name}
        </span>
        <span className={["text-[10px] transition-transform", isOpen ? "rotate-180" : ""].join(" ")}>
          ▼
        </span>
      </button>

      <div
        className={[
          "absolute left-0 top-[calc(100%+0.4rem)] z-20 w-full origin-top rounded border border-vscode-panelBorder bg-vscode-editorBg p-1 shadow-lg transition-all duration-150",
          isOpen
            ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
            : "pointer-events-none -translate-y-1 scale-95 opacity-0"
        ].join(" ")}
      >
        <div className="max-h-64 overflow-y-auto pr-0.5">
          {collections.map((collection) => {
            const isActive = collection.id === activeCollectionId;
            return (
              <div
                key={collection.id}
                className={[
                  "mb-1 flex w-full items-center justify-between gap-2 rounded px-1 py-1",
                  isActive
                    ? "bg-vscode-listActiveSelectionBg text-vscode-listActiveSelectionFg"
                    : "text-vscode-editorFg hover:bg-vscode-listHover"
                ].join(" ")}
              >
                <button
                  type="button"
                  onClick={() => handleSwitch(collection.id)}
                  className="min-w-0 flex-1 rounded px-1 py-0.5 text-left"
                >
                  <span className="flex items-center gap-1.5">
                    <span>{getSpecIcon(collection.specType)}</span>
                    <span className="truncate text-xs font-medium">{collection.name}</span>
                    <span className="rounded border border-vscode-panelBorder px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-vscode-descriptionFg">
                      {getSpecBadge(collection.specType)}
                    </span>
                  </span>
                  {collection.envName ? (
                    <span className="mt-0.5 block text-[10px] text-vscode-descriptionFg">
                      🔑 {collection.envName}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveCollection(collection.id)}
                  className="rounded px-1 py-0.5 text-[11px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
                  aria-label={`Remove ${collection.name}`}
                  title="Remove collection"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            setIsOpen(false);
            onLoadCollection();
          }}
          className="mt-1 flex w-full items-center gap-2 rounded border-t border-vscode-panelBorder px-2 py-1.5 text-left text-xs text-vscode-editorFg hover:bg-vscode-listHover"
        >
          <span className="text-sm">+</span>
          <span>Load another collection</span>
        </button>
      </div>
    </div>
  );
}
