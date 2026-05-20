import { create } from "zustand";

type AIMemory = {
  lessons: string[];

  confidenceScore: number;
};

type AIMemoryStore = {
  memories: Record<
    string,
    AIMemory
  >;

  addLesson: (
    bot: string,

    lesson: string
  ) => void;

  updateConfidence: (
    bot: string,

    confidence: number
  ) => void;

  updateMemory: (
    bot: string,

    memory: Partial<AIMemory>
  ) => void;
};

export const useAIMemoryStore =
  create<AIMemoryStore>(
    (set) => ({
      memories: {},

      addLesson: (
        bot,
        lesson
      ) =>
        set((state) => {
          const existing =
            state.memories[
              bot
            ] || {
              lessons: [],

              confidenceScore: 50,
            };

          return {
            memories: {
              ...state.memories,

              [bot]: {
                ...existing,

                lessons: [
                  lesson,

                  ...existing.lessons,
                ].slice(0, 20),
              },
            },
          };
        }),

      updateConfidence: (
        bot,
        confidence
      ) =>
        set((state) => {
          const existing =
            state.memories[
              bot
            ] || {
              lessons: [],

              confidenceScore: 50,
            };

          return {
            memories: {
              ...state.memories,

              [bot]: {
                ...existing,

                confidenceScore:
                  confidence,
              },
            },
          };
        }),

      updateMemory: (
        bot,
        memory
      ) =>
        set((state) => {
          const existing =
            state.memories[
              bot
            ] || {
              lessons: [],

              confidenceScore: 50,
            };

          return {
            memories: {
              ...state.memories,

              [bot]: {
                ...existing,

                ...memory,
              },
            },
          };
        }),
    })
  );