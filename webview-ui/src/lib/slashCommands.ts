export type SlashCommand = {
  name: string;
  description: string;
  requiresCollection: boolean;
};

export const COMMANDS: SlashCommand[] = [
  {
    name: "/find",
    description: "Search for requests by name or URL keyword",
    requiresCollection: true
  },
  {
    name: "/run",
    description: "Execute a specific request by name",
    requiresCollection: true
  },
  {
    name: "/summarize",
    description: "Get a high-level overview of the loaded collection",
    requiresCollection: true
  },
  {
    name: "/auth",
    description: "Explain the authentication scheme in the collection",
    requiresCollection: true
  },
  {
    name: "/export",
    description: "Export this conversation as a Markdown file",
    requiresCollection: false
  }
];

export function resolveSlashCommand(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const [command] = trimmed.split(/\s+/, 1);
  const match = COMMANDS.find((item) => item.name === command);
  return match ? match.name : null;
}
