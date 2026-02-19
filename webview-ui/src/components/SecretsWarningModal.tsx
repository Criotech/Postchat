type SecretFinding = {
  field: string;
  pattern: string;
  preview: string;
};

type SecretsWarningModalProps = {
  findings: SecretFinding[];
  onSendAnyway: () => void;
  onCancel: () => void;
};

export function SecretsWarningModal({
  findings,
  onSendAnyway,
  onCancel
}: SecretsWarningModalProps): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
      <div className="max-h-[80vh] w-full max-w-xl rounded-md border border-vscode-errorBorder bg-vscode-editorBg text-vscode-editorFg shadow-2xl">
        <div className="border-b border-vscode-errorBorder bg-vscode-errorBg px-4 py-3">
          <h2 className="text-base font-semibold text-vscode-errorFg">
            ⚠️ Possible Secrets Detected
          </h2>
          <p className="mt-1 text-sm text-vscode-editorFg">
            The following patterns were found in your collection. Review before sending to
            an external LLM.
          </p>
        </div>

        <div className="max-h-[45vh] overflow-y-auto px-4 py-3">
          <ul className="space-y-2">
            {findings.map((finding, index) => (
              <li
                key={`${finding.pattern}-${index}-${finding.preview}`}
                className="rounded border border-vscode-panelBorder bg-vscode-inputBg px-3 py-2"
              >
                <div className="text-sm font-medium text-vscode-editorFg">{finding.pattern}</div>
                <div className="mt-0.5 text-xs text-vscode-descriptionFg">{finding.preview}</div>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end gap-2 border-t border-vscode-panelBorder px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-vscode-inputBorder bg-vscode-inputBg px-3 py-1.5 text-sm text-vscode-inputFg hover:bg-vscode-listHover focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSendAnyway}
            className="rounded bg-vscode-errorBg px-3 py-1.5 text-sm font-semibold text-vscode-errorFg hover:opacity-90 focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
          >
            Send Anyway
          </button>
        </div>
      </div>
    </div>
  );
}
