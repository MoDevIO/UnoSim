export class OutputCollector {
  private total = 0;
  constructor(private readonly limit: number) {}
  append(chunk: string): boolean { this.total += Buffer.byteLength(chunk); return this.total <= this.limit; }
  get totalBytes(): number { return this.total; }
}
