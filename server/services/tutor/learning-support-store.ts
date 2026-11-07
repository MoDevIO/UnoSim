import { randomUUID } from "node:crypto";
import {
  TUTOR_REFERENCE_AFTER_ANSWER_ATTEMPTS,
  TUTOR_SKIP_AFTER_CLARIFICATIONS,
  type TutorQuestionOutcome,
  type TutorSupportState,
} from "@shared/tutor";
import { config, type ParsedTutorSessionConfig } from "../../config";

/** The asked question and what happened to it (LearningQuestions R-SUP-1, R-SUP-5, R-SUP-6). */
export interface SupportQuestion {
  readonly handle: string;
  readonly text: string;
  /** Code, project files, board and Course Content the question was asked for. */
  readonly contextKey: string;
  readonly answerAttempts: number;
  readonly clarifications: number;
  readonly outcome: TutorQuestionOutcome;
  readonly referenceShown: boolean;
  /** Earlier clarifications of this question; a further one has to go beyond them. */
  readonly clarificationTexts: readonly string[];
}

export interface SupportSessionView {
  readonly handle: string;
  /** The Course Content session the support session was opened with; null for the free Tutor. */
  readonly courseSession: string | null;
  readonly question: SupportQuestion | null;
  /** Questions left by skipping; the Tutor does not ask them again right away. */
  readonly skippedQuestions: readonly string[];
}

/** What a successful action changes; it is applied only after the action succeeded. */
export interface SupportUpdate {
  readonly question?: SupportQuestion | null;
  readonly skippedQuestion?: string;
}

export type SupportActionOutcome<T> =
  | { readonly status: "ok"; readonly body: T }
  | { readonly status: "missing" }
  | { readonly status: "conflict" }
  /** The action already ran; its result is no longer kept, so it is neither repeated nor counted again. */
  | { readonly status: "spent" }
  /** The session has run as many actions as it can remember; a new action needs a new question (review N5). */
  | { readonly status: "exhausted" };

type SessionEntry = {
  readonly identity: string;
  readonly courseSession: string | null;
  expiresAt: number;
  question: SupportQuestion | null;
  skippedQuestions: string[];
  readonly results: Map<string, { readonly fingerprint: string; readonly body: unknown }>;
  /** Every applied action id of the session, never forgotten while the session lives (reviews R7, N5). */
  readonly spent: Set<string>;
  readonly pending: Map<string, { readonly fingerprint: string; readonly result: Promise<SupportActionOutcome<unknown>> }>;
  queue: Promise<unknown>;
};

const MAX_REMEMBERED_ACTIONS = 32;
/** Actions one session can take; far above a learning dialog, bounded for memory. */
const MAX_SPENT_ACTIONS = 4_096;
const MAX_SKIPPED_QUESTIONS = 32;
const MAX_CLARIFICATION_TEXTS = 4;

export function newSupportQuestion(text: string, contextKey: string): SupportQuestion {
  return {
    handle: randomUUID(),
    text,
    contextKey,
    answerAttempts: 0,
    clarifications: 0,
    outcome: "open",
    referenceShown: false,
    clarificationTexts: [],
  };
}

/** The same question with counters and unlocks reset, under a new handle: its context changed (R-SUP-6). */
export function resetSupportQuestion(question: SupportQuestion, contextKey: string): SupportQuestion {
  return newSupportQuestion(question.text, contextKey);
}

export function withClarification(question: SupportQuestion, text: string): SupportQuestion {
  return {
    ...question,
    // The unlock counters saturate at the threshold (R-SUP-1); further clarifications stay possible.
    clarifications: Math.min(question.clarifications + 1, TUTOR_SKIP_AFTER_CLARIFICATIONS),
    clarificationTexts: [...question.clarificationTexts, text].slice(-MAX_CLARIFICATION_TEXTS),
  };
}

/** One more own answer, saturating at the threshold of the reference answer (R-SUP-1). */
export function withAnswerAttempt(question: SupportQuestion): SupportQuestion {
  return { ...question, answerAttempts: Math.min(question.answerAttempts + 1, TUTOR_REFERENCE_AFTER_ANSWER_ATTEMPTS) };
}

/** The server's view of the question for the response; the thresholds belong to the application. */
export function supportStateView(session: string, question: SupportQuestion, referenceAvailable: boolean): TutorSupportState {
  const closed = question.outcome !== "open";
  return {
    session,
    questionHandle: question.handle,
    answerAttempts: question.answerAttempts,
    clarifications: question.clarifications,
    canRevealReference: !closed && question.answerAttempts >= TUTOR_REFERENCE_AFTER_ANSWER_ATTEMPTS,
    canSkip: !closed && question.clarifications >= TUTOR_SKIP_AFTER_CLARIFICATIONS,
    referenceAvailable,
    referenceShown: question.referenceShown,
    outcome: question.outcome,
  };
}

/**
 * Subject-owned learning-support sessions in RAM, bounded like the Course Content sessions (absolute TTL,
 * sessions per subject and overall). Actions of one session run one after another; an action's update is
 * applied only when it succeeded, and its response is kept by `actionId`, so a retry returns the same
 * result instead of counting again (LearningQuestions R-SUP-1, R-SUP-6).
 */
export class TutorSupportStore {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly subjects = new Map<string, Set<string>>();

  constructor(
    private readonly limits: Pick<ParsedTutorSessionConfig, "ttlMs" | "maxSessions" | "maxSessionsPerSubject"> = config.tutor.sessions,
    private readonly now: () => number = Date.now,
  ) {}

  /** Opens a session for a newly asked question; called only after that question was delivered successfully. */
  open(identity: string, question: SupportQuestion, courseSession: string | null = null): string {
    this.sweepExpired();
    const own = this.subjects.get(identity);
    while (own && own.size >= this.limits.maxSessionsPerSubject) this.remove(firstOf(own));
    while (this.sessions.size >= this.limits.maxSessions) this.remove(firstOf(this.sessions.keys()));
    const handle = randomUUID();
    this.sessions.set(handle, {
      identity,
      courseSession,
      expiresAt: this.now() + this.limits.ttlMs,
      question,
      skippedQuestions: [],
      results: new Map(),
      spent: new Set(),
      pending: new Map(),
      queue: Promise.resolve(),
    });
    this.subjects.set(identity, (this.subjects.get(identity) ?? new Set()).add(handle));
    return handle;
  }

  view(identity: string, handle: string): SupportSessionView | null {
    this.sweepExpired();
    const entry = this.sessions.get(handle);
    if (entry?.identity !== identity) return null;
    return { handle, courseSession: entry.courseSession, question: entry.question, skippedQuestions: [...entry.skippedQuestions] };
  }

  /**
   * Runs one action of the session. The same `actionId` with the same request returns the first result
   * (also while it is still running); with a different request it is a conflict. `action` sees the
   * current state and returns the response with the update to apply; a failure applies nothing.
   */
  async run<T>(
    identity: string,
    handle: string,
    actionId: string,
    fingerprint: string,
    action: (view: SupportSessionView) => Promise<{ readonly body: T; readonly update: SupportUpdate }>,
  ): Promise<SupportActionOutcome<T>> {
    this.sweepExpired();
    const entry = this.sessions.get(handle);
    if (entry?.identity !== identity) return { status: "missing" };
    if (!entry.results.has(actionId) && entry.spent.has(actionId)) return { status: "spent" };
    const done = entry.results.get(actionId);
    if (done) return done.fingerprint === fingerprint ? { status: "ok", body: done.body as T } : { status: "conflict" };
    const running = entry.pending.get(actionId);
    if (running) {
      return running.fingerprint === fingerprint ? running.result as Promise<SupportActionOutcome<T>> : { status: "conflict" };
    }
    // Forgetting a spent id would let it count again, so a full session takes no new action (review N5).
    if (entry.spent.size + entry.pending.size >= MAX_SPENT_ACTIONS) return { status: "exhausted" };
    const execute = async (): Promise<SupportActionOutcome<T>> => {
      if (this.sessions.get(handle) !== entry) return { status: "missing" };
      const { body, update } = await action({ handle, courseSession: entry.courseSession, question: entry.question, skippedQuestions: [...entry.skippedQuestions] });
      if (this.sessions.get(handle) !== entry) return { status: "missing" };
      if (update.question !== undefined) entry.question = update.question;
      if (update.skippedQuestion !== undefined) {
        entry.skippedQuestions = [...entry.skippedQuestions, update.skippedQuestion].slice(-MAX_SKIPPED_QUESTIONS);
      }
      entry.results.set(actionId, { fingerprint, body });
      entry.spent.add(actionId);
      while (entry.results.size > MAX_REMEMBERED_ACTIONS) entry.results.delete(firstOf(entry.results.keys()));
      entry.expiresAt = this.now() + this.limits.ttlMs;
      this.touch(handle, entry);
      return { status: "ok", body };
    };
    const result = entry.queue.then(execute, execute);
    entry.queue = result.catch(() => undefined);
    entry.pending.set(actionId, { fingerprint, result });
    try {
      return await result;
    } finally {
      entry.pending.delete(actionId);
    }
  }

  stats(): { readonly sessions: number; readonly subjects: number } {
    this.sweepExpired();
    return { sessions: this.sessions.size, subjects: this.subjects.size };
  }

  private touch(handle: string, entry: SessionEntry): void {
    this.sessions.delete(handle);
    this.sessions.set(handle, entry);
    const own = this.subjects.get(entry.identity);
    own?.delete(handle);
    own?.add(handle);
  }

  private sweepExpired(): void {
    const now = this.now();
    for (const [handle, entry] of this.sessions) {
      if (entry.expiresAt <= now) this.remove(handle);
    }
  }

  private remove(handle: string): void {
    const entry = this.sessions.get(handle);
    if (!entry) return;
    this.sessions.delete(handle);
    const own = this.subjects.get(entry.identity);
    own?.delete(handle);
    if (own?.size === 0) this.subjects.delete(entry.identity);
  }
}

function firstOf<T>(values: Iterable<T>): T {
  const first = values[Symbol.iterator]().next();
  if (first.done) throw new Error("Expected a non-empty Tutor support collection");
  return first.value;
}
