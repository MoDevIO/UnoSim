import { describe, expect, it } from "vitest";
import { getTutorQuestionVisualState } from "@/lib/tutor-visual-state";

const idleInput = {
  tutorReady: true,
  question: null,
  isLoading: false,
  error: null,
};

describe("getTutorQuestionVisualState", () => {
  it("returns a neutral ready state when there is no active interaction", () => {
    expect(getTutorQuestionVisualState(idleInput)).toEqual({
      state: "idle",
      label: "Tutor ready",
      status: "bright",
    });
  });

  it("returns a neutral not-ready state without an animation", () => {
    expect(getTutorQuestionVisualState({ ...idleInput, tutorReady: false })).toEqual({
      state: "idle",
      label: "Tutor not ready",
      status: "bright",
    });
  });

  it("prioritizes generating while loading without a question", () => {
    expect(getTutorQuestionVisualState({
      ...idleInput,
      isLoading: true,
    })).toEqual({
      state: "generating",
      label: "Tutor is generating a question",
      status: "bright",
      animation: "generating",
    });
  });

  it("returns waiting when a question is available and no request is active", () => {
    expect(getTutorQuestionVisualState({
      ...idleInput,
      question: { question: "What do you observe?", answerRating: 1 },
    })).toEqual({
      state: "waiting",
      label: "Tutor is waiting for your answer",
      status: "bright",
      animation: "waiting",
    });
  });

  it("returns evaluating while loading an existing question", () => {
    expect(getTutorQuestionVisualState({
      ...idleInput,
      question: { question: "What do you observe?" },
      isLoading: true,
    })).toEqual({
      state: "evaluating",
      label: "Tutor is evaluating your answer",
      status: "bright",
      animation: "evaluating",
    });
  });

  it("prioritizes an explicit Tutor error over every loading or question state", () => {
    expect(getTutorQuestionVisualState({
      ...idleInput,
      question: { question: "What do you observe?" },
      isLoading: true,
      error: "The Tutor request was rejected",
    })).toEqual({
      state: "error",
      label: "Tutor error",
      status: "error",
      animation: "error",
    });
  });
});
