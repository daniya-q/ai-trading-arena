import { create } from "zustand";

export type ExecutionRecord = {
  bot: string;

  symbol: string;

  side: string;

  requestedPrice: number;

  executedPrice: number;

  slippage: number;

  fees: number;

  latency: number;

  timestamp: string;
};

type ExecutionStore = {
  executions: ExecutionRecord[];

  addExecution: (
    execution: ExecutionRecord
  ) => void;
};

export const useExecutionStore =
  create<ExecutionStore>(
    (set) => ({
      executions: [],

      addExecution: (
        execution
      ) =>
        set((state) => ({
          executions: [
            execution,

            ...state.executions,
          ].slice(0, 100),
        })),
    })
  );