import * as fs from "node:fs/promises";
import yaml from "js-yaml";
import type { SpecType } from "./types";

type UnknownRecord = Record<string, unknown>;

export async function detectSpecType(filePath: string): Promise<SpecType> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    throw new Error(`Could not read file: ${filePath}`);
  }

  const first100Lines = content.split(/\r?\n/).slice(0, 100).join("\n");
  const parsed = parsePreview(first100Lines) ?? parsePreview(content);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "unknown";
  }

  const root = parsed as UnknownRecord;

  if (
    isObject(root.info) &&
    typeof (root.info as UnknownRecord)._postman_id === "string"
  ) {
    return "postman";
  }

  if (Array.isArray(root.item)) {
    return "postman";
  }

  if (typeof root.openapi === "string" && root.openapi.startsWith("3.")) {
    return "openapi3";
  }

  if (typeof root.swagger === "string" && root.swagger.startsWith("2.")) {
    return "swagger2";
  }

  return "unknown";
}

function parsePreview(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    try {
      return yaml.load(content);
    } catch {
      return undefined;
    }
  }
}

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
