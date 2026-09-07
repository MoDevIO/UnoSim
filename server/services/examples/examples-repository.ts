import { BuiltInProvider } from "./built-in-provider";
import { HttpProvider } from "./http-provider";
import { manifestToCatalog, type ExampleRecord, type ExamplesSnapshot } from "./examples-schema";

export class ExamplesRepository {
  private readonly builtInProvider = new BuiltInProvider();
  private readonly httpProvider = new HttpProvider();
  private initialized: Promise<void> | null = null;
  private snapshot: ExamplesSnapshot | null = null;

  async initialize(): Promise<void> {
    this.initialized ??= this.refresh();
    await this.initialized;
  }

  async getCatalog() {
    await this.initialize();
    return manifestToCatalog(this.snapshot!);
  }

  async getExample(id: string) {
    await this.initialize();
    const example = this.snapshot!.examples.find((candidate) => candidate.id === id);
    if (!example) return null;
    const main = example.files.find((file) => file.name === example.main);
    const remaining = example.files.filter((file) => file !== main);
    return { ...example, files: main ? [main, ...remaining] : example.files };
  }

  private async refresh(): Promise<void> {
    const builtins = await this.builtInProvider.getExamples();
    const remote = await this.httpProvider.getExamples();
    const examples = [...builtins, ...(remote?.examples ?? [])];
    this.snapshot = {
      status: remote?.status ?? "builtin",
      stale: remote?.stale ?? false,
      examples: deduplicateExamples(examples),
    };
  }
}

function deduplicateExamples(examples: ExampleRecord[]): ExampleRecord[] {
  const ids = new Set<string>();
  return examples.filter((example) => {
    if (ids.has(example.id)) return false;
    ids.add(example.id);
    return true;
  });
}
