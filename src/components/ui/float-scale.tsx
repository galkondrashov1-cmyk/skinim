"use client";

import { useMemo } from "react";

interface FloatScaleProps {
  floatValue: number;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
}

// Float ranges for each condition
const CONDITIONS = [
  { name: "FN", min: 0, max: 0.07, color: "#22c55e" },      // Green
  { name: "MW", min: 0.07, max: 0.15, color: "#84cc16" },   // Lime
  { name: "FT", min: 0.15, max: 0.38, color: "#eab308" },   // Yellow
  { name: "WW", min: 0.38, max: 0.45, color: "#f97316" },   // Orange
  { name: "BS", min: 0.45, max: 1.0, color: "#ef4444" },    // Red
];

export function getFloatColor(floatValue: number): string {
  for (const condition of CONDITIONS) {
    if (floatValue >= condition.min && floatValue < condition.max) {
      return condition.color;
    }
  }
  return CONDITIONS[CONDITIONS.length - 1].color;
}

export function FloatScale({ floatValue, showLabel = false, size = "md" }: FloatScaleProps) {
  const position = useMemo(() => {
    // Clamp float value between 0 and 1
    const clamped = Math.max(0, Math.min(1, floatValue));
    return clamped * 100;
  }, [floatValue]);

  const currentColor = getFloatColor(floatValue);

  const heights = {
    sm: "h-1.5",
    md: "h-2",
    lg: "h-3",
  };

  const markerSizes = {
    sm: "w-2 h-2 -top-0.5",
    md: "w-2.5 h-2.5 -top-0.5",
    lg: "w-3 h-3 -top-0.5",
  };

  return (
    <div className="w-full">
      {/* Scale bar */}
      <div className={`relative w-full ${heights[size]} rounded-full overflow-hidden`}>
        {/* Gradient background */}
        <div
          className="absolute inset-0 flex"
          style={{
            background: `linear-gradient(to right,
              ${CONDITIONS[0].color} 0%,
              ${CONDITIONS[0].color} 7%,
              ${CONDITIONS[1].color} 7%,
              ${CONDITIONS[1].color} 15%,
              ${CONDITIONS[2].color} 15%,
              ${CONDITIONS[2].color} 38%,
              ${CONDITIONS[3].color} 38%,
              ${CONDITIONS[3].color} 45%,
              ${CONDITIONS[4].color} 45%,
              ${CONDITIONS[4].color} 100%
            )`,
          }}
        />

        {/* Position marker */}
        <div
          className={`absolute ${markerSizes[size]} rounded-full bg-white border-2 shadow-lg transition-all duration-300`}
          style={{
            left: `${position}%`,
            transform: "translateX(-50%)",
            borderColor: currentColor,
            boxShadow: `0 0 6px ${currentColor}`,
          }}
        />
      </div>

      {/* Labels */}
      {showLabel && (
        <div className="flex justify-between mt-1 text-[8px] text-zinc-500 font-medium">
          {CONDITIONS.map((c) => (
            <span key={c.name} style={{ color: c.color }}>
              {c.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
