import { useCallback } from "react";

// ─── TYPES ──────────────────────────────────────────────────

export type SourceType =
  | "postman_cloud"
  | "workspace_file"
  | "url_import"
  | "watched_file"
  | "git_tracked";

export type SourceStatus =
  | "connected"
  | "syncing"
  | "disconnected"
  | "error"
  | "stale";

export type SourceInfo = {
  id: string;
  type: SourceType;
  label: string;
  description: string;
  status: SourceStatus;
  lastSyncedAt: number | null;
  autoSync: boolean;
  errorMessage?: string;
};

type SourceManagerProps = {
  isOpen: boolean;
  activeSource: SourceInfo | null;
  sources: SourceInfo[];
  onClose: () => void;
  onConnectPostman: () => void;
  onImportFromUrl: () => void;
  onDetectWorkspace: () => void;
  onTrackWithGit: () => void;
  onActivateSource: (sourceId: string) => void;
  onRefreshSource: () => void;
  onLoadCollection: () => void;
};

// ─── HELPERS ────────────────────────────────────────────────

function sourceTypeLabel(type: SourceType): string {
  switch (type) {
    case "postman_cloud":
      return "Postman Cloud";
    case "workspace_file":
      return "Workspace File";
    case "url_import":
      return "URL Import";
    case "watched_file":
      return "Watched File";
    case "git_tracked":
      return "Git Tracked";
  }
}

function statusColor(status: SourceStatus): string {
  switch (status) {
    case "connected":
      return "bg-green-500";
    case "syncing":
      return "bg-yellow-400 animate-pulse";
    case "disconnected":
      return "bg-gray-400";
    case "error":
      return "bg-red-500";
    case "stale":
      return "bg-orange-400";
  }
}

function statusLabel(status: SourceStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "syncing":
      return "Syncing...";
    case "disconnected":
      return "Disconnected";
    case "error":
      return "Error";
    case "stale":
      return "Stale";
  }
}

function timeAgo(timestamp: number | null): string {
  if (!timestamp) {
    return "Never";
  }

  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) {
    return "Just now";
  }
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins}m ago`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours}h ago`;
  }
  const days = Math.floor(seconds / 86400);
  return `${days}d ago`;
}

// ─── ACTIVE SOURCE CARD ────────────────────────────────────

function ActiveSourceCard({
  source,
  onRefresh
}: {
  source: SourceInfo;
  onRefresh: () => void;
}): JSX.Element {
  return (
    <div className="rounded border border-vscode-panelBorder bg-vscode-inputBg/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-vscode-descriptionFg">
          Active Source
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded px-1.5 py-0.5 text-[10px] text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
          title="Refresh source"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>

      <div className="flex items-start gap-2.5">
        <div className={["mt-1.5 h-2 w-2 shrink-0 rounded-full", statusColor(source.status)].join(" ")} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-vscode-editorFg">
            {source.label}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-vscode-descriptionFg">
            {sourceTypeLabel(source.type)}
            <span className="mx-1 opacity-50">&middot;</span>
            {statusLabel(source.status)}
          </p>
          {source.lastSyncedAt ? (
            <p className="mt-0.5 text-[10px] text-vscode-descriptionFg">
              Last synced: {timeAgo(source.lastSyncedAt)}
            </p>
          ) : null}
          {source.errorMessage ? (
            <p className="mt-1 text-[10px] text-red-400">
              {source.errorMessage}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── SOURCE OPTION CARD ─────────────────────────────────────

function SourceOptionCard({
  title,
  description,
  icon,
  onClick
}: {
  title: string;
  description: string;
  icon: JSX.Element;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded border border-vscode-panelBorder bg-vscode-inputBg/40 p-2.5 text-left transition-colors hover:border-vscode-focusBorder hover:bg-vscode-listHover focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
    >
      <div className="mt-0.5 shrink-0 text-vscode-descriptionFg">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-vscode-editorFg">{title}</p>
        <p className="mt-0.5 text-[10px] text-vscode-descriptionFg">{description}</p>
      </div>
    </button>
  );
}

// ─── RECENT SOURCE ITEM ─────────────────────────────────────

function RecentSourceItem({
  source,
  isActive,
  onActivate
}: {
  source: SourceInfo;
  isActive: boolean;
  onActivate: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onActivate}
      disabled={isActive}
      className={[
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
        isActive
          ? "bg-vscode-listActiveSelectionBg text-vscode-listActiveSelectionFg"
          : "text-vscode-editorFg hover:bg-vscode-listHover"
      ].join(" ")}
    >
      <div className={["h-1.5 w-1.5 shrink-0 rounded-full", statusColor(source.status)].join(" ")} />
      <span className="min-w-0 flex-1 truncate">{source.label}</span>
      <span className="shrink-0 text-[10px] text-vscode-descriptionFg">
        {sourceTypeLabel(source.type)}
      </span>
    </button>
  );
}

// ─── ICONS ──────────────────────────────────────────────────

function CloudIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

function LinkIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function FolderIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function GitIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <line x1="6" y1="9" x2="6" y2="21" />
    </svg>
  );
}

function FileIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────────

export function SourceManager({
  isOpen,
  activeSource,
  sources,
  onClose,
  onConnectPostman,
  onImportFromUrl,
  onDetectWorkspace,
  onTrackWithGit,
  onActivateSource,
  onRefreshSource,
  onLoadCollection
}: SourceManagerProps): JSX.Element | null {
  const inactiveSources = sources.filter((s) => s.id !== activeSource?.id);

  const handleSourceAction = useCallback(
    (action: () => void) => {
      onClose();
      action();
    },
    [onClose]
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-vscode-editorBg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-vscode-panelBorder px-3 py-2">
        <h2 className="text-xs font-semibold">Source Manager</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-vscode-descriptionFg hover:bg-vscode-listHover hover:text-vscode-editorFg"
          aria-label="Close Source Manager"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {/* Active Source */}
        {activeSource ? (
          <div className="mb-4">
            <ActiveSourceCard source={activeSource} onRefresh={onRefreshSource} />
          </div>
        ) : null}

        {/* Add a Source */}
        <div className="mb-4">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-vscode-descriptionFg">
            Add a Source
          </h3>
          <div className="flex flex-col gap-1.5">
            <SourceOptionCard
              title="Postman Cloud"
              description="Connect with your API key to sync collections"
              icon={<CloudIcon />}
              onClick={() => handleSourceAction(onConnectPostman)}
            />
            <SourceOptionCard
              title="Import from URL"
              description="Load an OpenAPI spec or Postman collection from a URL"
              icon={<LinkIcon />}
              onClick={() => handleSourceAction(onImportFromUrl)}
            />
            <SourceOptionCard
              title="Detect in Workspace"
              description="Scan for API specs and Postman exports in your project"
              icon={<FolderIcon />}
              onClick={() => handleSourceAction(onDetectWorkspace)}
            />
            <SourceOptionCard
              title="Track with Git"
              description="Watch a spec file and auto-reload on commits"
              icon={<GitIcon />}
              onClick={() => handleSourceAction(onTrackWithGit)}
            />
            <SourceOptionCard
              title="Load from File"
              description="Pick a local JSON or YAML file to load"
              icon={<FileIcon />}
              onClick={() => handleSourceAction(onLoadCollection)}
            />
          </div>
        </div>

        {/* Recent / Other Sources */}
        {inactiveSources.length > 0 ? (
          <div>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-vscode-descriptionFg">
              Other Sources
            </h3>
            <div className="flex flex-col gap-0.5">
              {inactiveSources.map((source) => (
                <RecentSourceItem
                  key={source.id}
                  source={source}
                  isActive={false}
                  onActivate={() => {
                    onClose();
                    onActivateSource(source.id);
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
