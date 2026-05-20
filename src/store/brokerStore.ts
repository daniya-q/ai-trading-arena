import { create } from "zustand";

type BrokerStore = {
  paperTrading: boolean;

  brokerConnected: boolean;

  setPaperTrading: (
    enabled: boolean
  ) => void;

  setBrokerConnected: (
    connected: boolean
  ) => void;
};

export const useBrokerStore =
  create<BrokerStore>(
    (set) => ({
      paperTrading: true,

      brokerConnected: false,

      setPaperTrading: (
        enabled
      ) =>
        set({
          paperTrading:
            enabled,
        }),

      setBrokerConnected: (
        connected
      ) =>
        set({
          brokerConnected:
            connected,
        }),
    })
  );