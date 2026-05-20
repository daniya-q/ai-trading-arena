import { create } from "zustand";

export type AIThought = {
  bot: string;

  thought: string;

  confidence: number;

  marketRegime: string;

  action: string;

  timestamp: string;
};

type AIThoughtStore = {
  thoughts: AIThought[];

  addThought: (
    thought: AIThought
  ) => void;
};

export const useAIThoughtStore =
  create<AIThoughtStore>(
    (set) => ({
      thoughts: [],

      addThought: (
        thought
      ) =>
        set((state) => ({
          thoughts: [
            thought,

            ...state.thoughts,
          ].slice(0, 50),
        })),
    })
  );