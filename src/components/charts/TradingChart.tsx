"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const data = [
  {
    time: "09:15",
    value: 24200,
  },

  {
    time: "10:00",
    value: 24320,
  },

  {
    time: "11:00",
    value: 24280,
  },

  {
    time: "12:00",
    value: 24450,
  },

  {
    time: "13:00",
    value: 24520,
  },

  {
    time: "14:00",
    value: 24480,
  },

  {
    time: "15:00",
    value: 24610,
  },
];

export default function TradingChart() {
  return (
    <div className="w-full h-[400px]">

      <ResponsiveContainer
        width="100%"
        height="100%"
      >

        <LineChart data={data}>

          <XAxis
            dataKey="time"
            stroke="#a1a1aa"
          />

          <YAxis
            stroke="#a1a1aa"
          />

          <Tooltip />

          <Line
            type="monotone"
            dataKey="value"
            stroke="#22c55e"
            strokeWidth={3}
            dot={false}
          />

        </LineChart>

      </ResponsiveContainer>

    </div>
  );
}