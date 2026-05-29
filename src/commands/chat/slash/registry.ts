import type { ParsedSlashInput } from "./parser.js";
import type { RegisteredSlashCommandSpec } from "./types.js";

export class SlashCommandRegistry {
  private readonly specs: RegisteredSlashCommandSpec[];
  private readonly byName = new Map<string, RegisteredSlashCommandSpec>();

  constructor(specs: readonly RegisteredSlashCommandSpec[] = []) {
    this.specs = [];
    this.registerMany(specs);
  }

  register(spec: RegisteredSlashCommandSpec): void {
    const names = [spec.name, ...spec.aliases].map((name) => name.toLowerCase());
    for (const name of names) {
      if (!name.startsWith("/") && !name.startsWith(":")) {
        throw new Error(`Invalid slash command name: ${name}`);
      }
      if (this.byName.has(name)) {
        throw new Error(`Duplicate slash command name: ${name}`);
      }
    }
    this.specs.push(spec);
    for (const name of names) this.byName.set(name, spec);
  }

  registerMany(specs: readonly RegisteredSlashCommandSpec[]): void {
    for (const spec of specs) this.register(spec);
  }

  find(command: string): RegisteredSlashCommandSpec | undefined {
    return this.byName.get(command.toLowerCase());
  }

  resolve(parsed: ParsedSlashInput): RegisteredSlashCommandSpec | undefined {
    return this.find(parsed.command);
  }

  list(): readonly RegisteredSlashCommandSpec[] {
    return this.specs;
  }
}

export function createSlashCommandRegistry(specs: readonly RegisteredSlashCommandSpec[]): SlashCommandRegistry {
  return new SlashCommandRegistry(specs);
}
