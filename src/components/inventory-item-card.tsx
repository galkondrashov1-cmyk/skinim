"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { InventoryItem } from "@/types/inventory";
import { formatTradeLockTime, getConditionShort } from "@/lib/utils";
import { useState } from "react";

interface InventoryItemCardProps {
  item: InventoryItem;
  index: number;
}

export function InventoryItemCard({ item, index }: InventoryItemCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [imageError, setImageError] = useState(false);

  const tradeStatus = formatTradeLockTime(item.tradable_after || null);
  const isTradable = item.tradable && tradeStatus === "ניתן למסחר";

  const rarityColor = item.rarity_color || "#b0c3d9";

  // Strip condition from name if it's shown separately (e.g., "AK-47 | Redline (Field-Tested)" -> "AK-47 | Redline")
  const displayName = item.condition
    ? item.name.replace(/\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i, '')
    : item.name;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.02 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group relative"
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border bg-zinc-900/80 backdrop-blur-sm transition-all duration-300",
          "hover:scale-105 hover:shadow-2xl",
          isHovered ? "border-white/30" : "border-white/10"
        )}
        style={{
          boxShadow: isHovered ? `0 0 30px ${rarityColor}40` : "none",
        }}
      >
        {/* Rarity indicator bar */}
        <div
          className="absolute top-0 left-0 right-0 h-1"
          style={{ backgroundColor: rarityColor }}
        />

        {/* Item image */}
        <div className="relative aspect-square p-4">
          <div className="relative h-full w-full">
            {!imageError ? (
              <Image
                src={item.icon_url_large || item.icon_url}
                alt={item.name}
                fill
                className="object-contain transition-transform duration-300 group-hover:scale-110"
                onError={() => setImageError(true)}
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-zinc-500">
                <span className="text-xs">אין תמונה</span>
              </div>
            )}
          </div>

          {/* Float value badge */}
          {item.float_value !== undefined && (
            <div className="absolute top-2 right-2 rounded-md bg-black/70 px-2 py-1 text-xs font-mono text-white backdrop-blur-sm">
              {item.float_value.toFixed(6)}
            </div>
          )}

          {/* Trade status indicator */}
          <div
            className={cn(
              "absolute bottom-2 right-2 rounded-md px-2 py-1 text-xs font-medium backdrop-blur-sm",
              isTradable
                ? "bg-green-500/20 text-green-400"
                : "bg-orange-500/20 text-orange-400"
            )}
          >
            {tradeStatus}
          </div>
        </div>

        {/* Item info */}
        <div className="border-t border-white/10 p-3">
          <p className="truncate text-sm font-medium text-white" title={displayName}>
            {displayName}
          </p>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs text-zinc-400">{item.type}</span>
            {item.condition && (
              <span
                className="rounded px-1.5 py-0.5 text-xs font-medium"
                style={{ backgroundColor: `${rarityColor}30`, color: rarityColor }}
              >
                {getConditionShort(item.condition)}
              </span>
            )}
          </div>
        </div>

        {/* Hover overlay with more details */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: isHovered ? 1 : 0 }}
          className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 pointer-events-none"
        >
          <div className="space-y-1">
            <p className="text-sm font-semibold text-white">{item.market_name}</p>
            {item.rarity && (
              <p className="text-xs" style={{ color: rarityColor }}>
                {item.rarity}
              </p>
            )}
            {item.float_value !== undefined && (
              <p className="text-xs text-zinc-300">
                Float: <span className="font-mono text-white">{item.float_value.toFixed(10)}</span>
              </p>
            )}
            {item.paint_seed && (
              <p className="text-xs text-zinc-300">
                Pattern: <span className="text-white" dir="ltr">{item.paint_seed}</span>
              </p>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
