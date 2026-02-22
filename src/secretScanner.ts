// ── Possible Secrets Detected feature commented out ──────────────────────────

// export type SecretFinding = {
//   field: string;
//   pattern: string;
//   preview: string;
// };

// type PatternSpec = {
//   name: string;
//   regex: RegExp;
// };

// const SECRET_PATTERNS: PatternSpec[] = [
//   {
//     name: "Bearer token",
//     regex: /Bearer\s+[A-Za-z0-9\-_]{20,}/i
//   },
//   {
//     name: "API key prefix",
//     regex: /\b(sk-|pk-|api_key=|apikey=)[A-Za-z0-9\-_]{16,}/i
//   },
//   {
//     name: "Basic auth base64",
//     regex: /Basic\s+[A-Za-z0-9+/]{20,}={0,2}/i
//   },
//   {
//     name: "AWS access key",
//     regex: /AKIA[0-9A-Z]{16}/
//   },
//   {
//     name: "Long hex secret",
//     regex: /\b[0-9a-fA-F]{32,}\b/
//   },
//   {
//     name: "Password in JSON",
//     regex: /"password"\s*:\s*"[^"]{4,}"/i
//   }
// ];

// export function scanForSecrets(collectionMarkdown: string): SecretFinding[] {
//   const findings: SecretFinding[] = [];
//
//   for (const pattern of SECRET_PATTERNS) {
//     const globalRegex = new RegExp(pattern.regex.source, withGlobalFlag(pattern.regex.flags));
//     let match: RegExpExecArray | null;
//
//     while ((match = globalRegex.exec(collectionMarkdown)) !== null) {
//       const matchedText = match[0];
//       const index = match.index ?? 0;
//
//       findings.push({
//         field: extractFieldContext(collectionMarkdown, index, matchedText.length),
//         pattern: pattern.name,
//         preview: redactPreview(matchedText)
//       });
//     }
//   }
//
//   return findings;
// }

// function withGlobalFlag(flags: string): string {
//   return flags.includes("g") ? flags : `${flags}g`;
// }

// function extractFieldContext(source: string, index: number, matchLength: number): string {
//   const start = Math.max(0, index - 10);
//   const end = Math.min(source.length, index + matchLength + 10);
//   return source.slice(start, end).replace(/\s+/g, " ").trim();
// }

// function redactPreview(value: string): string {
//   if (value.length <= 8) {
//     return `${value.slice(0, 4)}...${value.slice(-4)}`;
//   }
//
//   return `${value.slice(0, 4)}...${value.slice(-4)}`;
// }
