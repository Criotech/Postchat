import * as fs from "node:fs";
import * as vscode from "vscode";

type PostmanEnvironment = {
  values?: Array<{
    key?: string;
    value?: unknown;
    enabled?: boolean;
  }>;
};

export function parseEnvironment(filePath: string): Record<string, string> {
  const content = readEnvironmentFile(filePath);
  const parsed = parseEnvironmentJson(content);

  if (!Array.isArray(parsed.values)) {
    throw new Error("Invalid Postman environment file: missing values array.");
  }

  const variables: Record<string, string> = {};
  for (const variable of parsed.values) {
    if (!variable || typeof variable !== "object") {
      continue;
    }

    const isEnabled = variable.enabled ?? true;
    if (!isEnabled || !variable.key) {
      continue;
    }

    variables[variable.key] = stringifyValue(variable.value);
  }

  return variables;
}

export async function pickEnvironmentFile(): Promise<string | undefined> {
  const files = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    filters: {
      "JSON Files": ["json"]
    },
    openLabel: "Select Postman Environment File"
  });

  if (!files || files.length === 0) {
    return undefined;
  }

  return files[0].fsPath;
}

function readEnvironmentFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read environment file: ${message}`);
  }
}

function parseEnvironmentJson(content: string): PostmanEnvironment {
  try {
    const parsed = JSON.parse(content) as PostmanEnvironment;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Environment content must be a JSON object.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Invalid Postman environment file: ${error.message}`);
    }
    throw new Error("Invalid Postman environment file.");
  }
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return String(value);
}
