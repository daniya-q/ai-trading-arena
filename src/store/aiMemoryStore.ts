import { create } from "zustand";
import { supabase } from "@/lib/supabase/client";

type AIMemory = {
  lessons: string[];

  confidenceScore: number;
};

type AIMemoryStore = {
  memories: Record<
    string,
    AIMemory
  >;

  loadFromSupabase: () => Promise<void>;

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
    (set, get) => ({
      memories: {},

      loadFromSupabase: async () => {
        const { data, error } =
          await supabase
            .from("ai_memory")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
          console.error(
            "[AIMemory] Supabase load failed:",
            error.message
          );
          return;
        }

        if (!data || data.length === 0) return;

        const memories: Record<string, AIMemory> = {};

        data.forEach((row) => {
          if (!memories[row.bot_id]) {
            memories[row.bot_id] = {
              lessons: [],
              confidenceScore: 50,
            };
          }
          if (memories[row.bot_id].lessons.length < 20) {
            memories[row.bot_id].lessons.push(row.lesson);
          }
          // Most recent row (ordered desc) sets the confidence
          if (memories[row.bot_id].lessons.length === 1) {
            memories[row.bot_id].confidenceScore = Number(
              row.confidence_score
            );
          }
        });

        set({ memories });
      },

      addLesson: (
        bot,
        lesson
      ) => {
        const existing =
          get().memories[bot] || {
            lessons: [],
            confidenceScore: 50,
          };

        set((state) => {
          const current =
            state.memories[bot] || {
              lessons: [],
              confidenceScore: 50,
            };

          return {
            memories: {
              ...state.memories,

              [bot]: {
                ...current,

                lessons: [
                  lesson,

                  ...current.lessons,
                ].slice(0, 20),
              },
            },
          };
        });

        // Persist to Supabase (fire-and-forget)
        supabase
          .from("ai_memory")
          .insert({
            bot_id: bot,
            lesson,
            confidence_score: existing.confidenceScore,
          })
          .then(({ error }) => {
            if (error) {
              console.error(
                "[AIMemory] Supabase insert failed:",
                error.message
              );
            }
          });
      },

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
