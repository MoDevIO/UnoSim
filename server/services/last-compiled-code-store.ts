/**
 * Last successfully compiled code per authenticated subject, for the legacy
 * `start_simulation` without `code`. Keyed by subject so that a start never
 * runs code another user compiled; bounded so idle subjects cannot grow it.
 */
export class LastCompiledCodeStore {
  private readonly codeBySubject = new Map<string, string>();

  constructor(private readonly maxSubjects: number) {}

  set(subject: string, code: string): void {
    this.codeBySubject.delete(subject);
    this.codeBySubject.set(subject, code);
    while (this.codeBySubject.size > this.maxSubjects) {
      const oldest = this.codeBySubject.keys().next().value;
      if (oldest === undefined) break;
      this.codeBySubject.delete(oldest);
    }
  }

  get(subject: string): string | null {
    return this.codeBySubject.get(subject) ?? null;
  }
}
