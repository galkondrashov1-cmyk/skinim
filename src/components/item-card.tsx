"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { useState } from "react";
import { FloatScale, getFloatColor } from "./ui/float-scale";
import { cn } from "@/lib/utils";

// CS2 Official Rarity Colors
const CS2_RARITY_COLORS: Record<string, string> = {
  // Weapons
  "Consumer Grade": "#b0c3d9",
  "Industrial Grade": "#5e98d9",
  "Mil-Spec Grade": "#4b69ff",
  "Mil-Spec": "#4b69ff",
  "Restricted": "#8847ff",
  "Classified": "#d32ce6",
  "Covert": "#eb4b4b",
  "Contraband": "#e4ae39",
  // Knives & Gloves (gold/yellow)
  "Extraordinary": "#e4ae39",
  "Melee": "#e4ae39",
  // Stickers/Agents/Other
  "Base Grade": "#b0c3d9",
  "High Grade": "#4b69ff",
  "Remarkable": "#8847ff",
  "Exotic": "#d32ce6",
  // Default
  "Normal": "#b0c3d9",
};

function getRarityColor(rarity: string | undefined, providedColor: string | undefined): string {
  // First check if we have an official CS2 color for this rarity
  if (rarity && CS2_RARITY_COLORS[rarity]) {
    return CS2_RARITY_COLORS[rarity];
  }

  // Check if rarity contains any known keywords
  if (rarity) {
    const rarityLower = rarity.toLowerCase();
    if (rarityLower.includes("contraband")) return "#e4ae39";
    if (rarityLower.includes("covert")) return "#eb4b4b";
    if (rarityLower.includes("classified") || rarityLower.includes("exotic")) return "#d32ce6";
    if (rarityLower.includes("restricted") || rarityLower.includes("remarkable")) return "#8847ff";
    if (rarityLower.includes("mil-spec") || rarityLower.includes("high grade")) return "#4b69ff";
    if (rarityLower.includes("industrial")) return "#5e98d9";
    if (rarityLower.includes("consumer") || rarityLower.includes("base grade")) return "#b0c3d9";
  }

  // Use provided color if available
  if (providedColor) {
    return providedColor.startsWith("#") ? providedColor : `#${providedColor}`;
  }

  // Default gray
  return "#b0c3d9";
}

interface StickerData {
  name: string;
  icon_url?: string;
  slot: number;
}

interface ItemCardProps {
  item: {
    id: string | number;
    name: string;
    skin_name?: string;
    weapon_type?: string;
    type?: string;
    rarity?: string;
    rarity_color?: string;
    condition?: string;
    condition_name?: string;
    float_value?: number | null;
    paint_seed?: number | null;
    image_url?: string;
    icon_url?: string;
    icon_url_large?: string;
    stickers?: StickerData[] | null;
    sticker_count?: number;
    patch_count?: number;
    tradable?: boolean;
    tradable_after?: string | null;
  };
  index?: number;
  variant?: "grid" | "compact";
}

export function ItemCard({ item, index = 0, variant = "grid" }: ItemCardProps) {
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Get the image URL
  const imageUrl = item.icon_url_large || item.icon_url || item.image_url;
  const fullImageUrl = imageUrl?.startsWith("http")
    ? imageUrl
    : imageUrl
    ? `https://community.akamai.steamstatic.com/economy/image/${imageUrl}`
    : null;

  // Get rarity color - prioritize CS2 official colors
  const rarityColor = getRarityColor(item.rarity, item.rarity_color);

  // Get condition display
  const condition = item.condition || item.condition_name;
  const conditionShort = condition
    ? {
        "Factory New": "FN",
        "Minimal Wear": "MW",
        "Field-Tested": "FT",
        "Well-Worn": "WW",
        "Battle-Scarred": "BS",
      }[condition] || condition
    : null;

  // Get display name (skin name or full name)
  const displayName = item.skin_name || item.name;
  const weaponType = item.weapon_type || item.type || "";

  // Float value
  const floatValue = item.float_value;
  const hasFloat = floatValue !== undefined && floatValue !== null;

  // Stickers/Patches
  const stickers = item.stickers || [];
  const stickerCount = item.sticker_count || stickers.length;
  const patchCount = item.patch_count || 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.015 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group relative h-full"
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border transition-all duration-300 h-full flex flex-col",
          "bg-gradient-to-b from-zinc-900/90 to-zinc-950/90 backdrop-blur-sm",
          isHovered
            ? "border-white/20 scale-[1.02] shadow-xl"
            : "border-white/[0.08]"
        )}
        style={{
          boxShadow: isHovered ? `0 8px 32px ${rarityColor}25` : "none",
        }}
      >
        {/* Rarity glow at top */}
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ backgroundColor: rarityColor }}
        />
        <div
          className="absolute inset-x-0 top-0 h-8 opacity-20"
          style={{
            background: `linear-gradient(to bottom, ${rarityColor}, transparent)`,
          }}
        />

        {/* Item image */}
        <div className="relative aspect-square p-3">
          {fullImageUrl && !imageError ? (
            <Image
              src={fullImageUrl}
              alt={item.name}
              fill
              className="object-contain p-2 transition-transform duration-300 group-hover:scale-105"
              onError={() => setImageError(true)}
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-zinc-600">
              <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}

          {/* Stickers/Patches display */}
          {stickers.length > 0 && (
            <div className="absolute bottom-2 left-2 right-2 flex justify-center gap-1">
              {stickers.slice(0, 5).map((sticker, idx) => (
                <div
                  key={idx}
                  className="relative w-8 h-8 rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 p-0.5 transition-transform hover:scale-110"
                  title={sticker.name}
                >
                  {sticker.icon_url && (
                    <Image
                      src={
                        sticker.icon_url.startsWith("http")
                          ? sticker.icon_url
                          : `https://community.akamai.steamstatic.com/economy/image/${sticker.icon_url}`
                      }
                      alt={sticker.name}
                      fill
                      className="object-contain p-0.5"
                      unoptimized
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Item info - flex-grow to fill remaining space */}
        <div className="p-3 pt-0 flex flex-col flex-grow">
          {/* Float Scale - Fixed height container whether float exists or not */}
          <div className="h-[42px] mb-1">
            {hasFloat ? (
              <div className="space-y-1">
                <FloatScale floatValue={floatValue} size="sm" />
                <div className="flex items-center justify-between">
                  <span
                    className="text-[10px] font-mono font-medium"
                    style={{ color: getFloatColor(floatValue) }}
                  >
                    {floatValue.toFixed(6)}
                  </span>
                  {conditionShort && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: `${getFloatColor(floatValue)}20`,
                        color: getFloatColor(floatValue),
                      }}
                    >
                      {conditionShort}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              // Empty placeholder when no float
              <div className="flex items-center justify-center h-full">
                {conditionShort && (
                  <span className="text-[10px] font-medium text-zinc-500 px-2 py-1 rounded bg-white/5">
                    {conditionShort}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Name and type - always at bottom */}
          <div className="border-t border-white/5 pt-2 mt-auto">
            <p
              className="text-sm font-medium text-white truncate"
              title={displayName}
            >
              {displayName}
            </p>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] text-zinc-500">{weaponType}</span>
              <div className="flex items-center gap-1.5">
                {stickerCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-purple-400">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                    {stickerCount}
                  </span>
                )}
                {patchCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-orange-400">
                    🏷️ {patchCount}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
