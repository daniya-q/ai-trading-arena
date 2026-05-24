"use client";

import { useEffect, useRef } from "react";

type Star = {
  x: number;
  y: number;
  r: number;
  opacity: number;
  dx: number;
  dy: number;
  phase: number;
  phaseSpeed: number;
};

type ShootingStar = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  trailLen: number;
  opacity: number;
};

const NEBULA_CONFIGS = [
  { rx: 0.18, ry: 0.28, r: 220, c: "rgba(100,50,200,0.07)" },
  { rx: 0.82, ry: 0.18, r: 180, c: "rgba(50,80,200,0.05)" },
  { rx: 0.25, ry: 0.72, r: 200, c: "rgba(80,30,180,0.05)" },
  { rx: 0.76, ry: 0.65, r: 160, c: "rgba(60,60,220,0.04)" },
];

export default function SpaceBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // No animation on mobile — just solid background via CSS
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let shooting: ShootingStar | null = null;
    let nextShootAt = Date.now() + 8000 + Math.random() * 2000;

    function resize() {
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    // Build 400 stars using initial canvas dimensions
    const W = canvas.width;
    const H = canvas.height;

    const stars: Star[] = Array.from(
      { length: 400 },
      () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.3 + 0.2,
        opacity: Math.random() * 0.7 + 0.15,
        dx: (Math.random() - 0.5) * 0.035,
        dy: (Math.random() - 0.5) * 0.035,
        phase: Math.random() * Math.PI * 2,
        phaseSpeed: 0.008 + Math.random() * 0.018,
      })
    );

    function spawnShooting() {
      const W = canvas!.width;
      const H = canvas!.height;
      const fromTop = Math.random() < 0.6;
      const sx = fromTop ? Math.random() * W : 0;
      const sy = fromTop ? 0 : Math.random() * H * 0.5;
      const angle = Math.PI / 4 + (Math.random() - 0.5) * 0.4;
      const spd = 10 + Math.random() * 7;
      shooting = {
        x: sx,
        y: sy,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        trailLen: 70 + Math.random() * 60,
        opacity: 1,
      };
    }

    function draw() {
      const W = canvas!.width;
      const H = canvas!.height;

      // Deep space fill
      ctx!.fillStyle = "#050508";
      ctx!.fillRect(0, 0, W, H);

      // Nebula clouds
      NEBULA_CONFIGS.forEach((n) => {
        const cx = n.rx * W;
        const cy = n.ry * H;
        const grad = ctx!.createRadialGradient(cx, cy, 0, cx, cy, n.r);
        grad.addColorStop(0, n.c);
        grad.addColorStop(0.5, n.c.replace(/[\d.]+\)$/, "0.02)"));
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(cx, cy, n.r, 0, Math.PI * 2);
        ctx!.fill();
      });

      // Stars
      stars.forEach((s) => {
        s.x += s.dx;
        s.y += s.dy;
        s.phase += s.phaseSpeed;

        if (s.x < 0) s.x = W;
        else if (s.x > W) s.x = 0;
        if (s.y < 0) s.y = H;
        else if (s.y > H) s.y = 0;

        const twinkled =
          s.opacity * (0.65 + 0.35 * Math.sin(s.phase));

        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(255,255,255,${twinkled.toFixed(3)})`;
        ctx!.fill();
      });

      // Shooting star
      if (Date.now() > nextShootAt && !shooting) {
        spawnShooting();
        nextShootAt =
          Date.now() + 8000 + Math.random() * 2000;
      }

      if (shooting) {
        const ss = shooting;
        const tailX = ss.x - ss.vx * (ss.trailLen / 11);
        const tailY = ss.y - ss.vy * (ss.trailLen / 11);

        const grad = ctx!.createLinearGradient(
          tailX,
          tailY,
          ss.x,
          ss.y
        );
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(
          1,
          `rgba(220,220,255,${ss.opacity.toFixed(3)})`
        );

        ctx!.beginPath();
        ctx!.moveTo(tailX, tailY);
        ctx!.lineTo(ss.x, ss.y);
        ctx!.strokeStyle = grad;
        ctx!.lineWidth = 1.8;
        ctx!.stroke();

        ss.x += ss.vx;
        ss.y += ss.vy;
        ss.opacity -= 0.016;

        if (
          ss.opacity <= 0 ||
          ss.x > W + 100 ||
          ss.y > H + 100
        ) {
          shooting = null;
        }
      }

      animId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: -1,
        background: "#050508",
        pointerEvents: "none",
      }}
    />
  );
}
