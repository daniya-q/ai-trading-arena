"use client";

import { useState } from "react";

import {
  startAmbience,
  stopAmbience,
} from "@/lib/sound/spaceAmbience";

export default function SoundToggle() {
  const [on, setOn] = useState(false);

  function toggle() {
    if (on) {
      stopAmbience();
    } else {
      startAmbience();
    }
    setOn((prev) => !prev);
  }

  return (
    <button
      onClick={toggle}
      title={
        on
          ? "Mute space ambience"
          : "Play space ambience"
      }
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 50,
        width: 44,
        height: 44,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        background: "rgba(10,10,25,0.85)",
        border: "1px solid rgba(255,255,255,0.1)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        color: on ? "#a78bfa" : "#52525b",
        fontSize: 18,
        transition: "color 0.2s, border-color 0.2s",
        borderColor: on
          ? "rgba(167,139,250,0.3)"
          : "rgba(255,255,255,0.1)",
      }}
    >
      {on ? "🔊" : "🔇"}
    </button>
  );
}
