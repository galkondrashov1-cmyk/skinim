import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function extractSteamIdFromTradeLink(tradeLink: string): string | null {
  const match = tradeLink.match(/partner=(\d+)/);
  if (!match) return null;

  // Convert partner ID to SteamID64
  const partnerId = parseInt(match[1], 10);
  const steamId64 = BigInt(partnerId) + BigInt("76561197960265728");
  return steamId64.toString();
}

export function getConditionFromFloat(floatValue: number): string {
  if (floatValue < 0.07) return "Factory New";
  if (floatValue < 0.15) return "Minimal Wear";
  if (floatValue < 0.38) return "Field-Tested";
  if (floatValue < 0.45) return "Well-Worn";
  return "Battle-Scarred";
}

export function getConditionShort(condition: string): string {
  const map: Record<string, string> = {
    "Factory New": "FN",
    "Minimal Wear": "MW",
    "Field-Tested": "FT",
    "Well-Worn": "WW",
    "Battle-Scarred": "BS",
  };
  return map[condition] || condition;
}

export function formatTradeLockTime(tradableAfter: string | null): string {
  if (!tradableAfter) return "ניתן למסחר";

  const tradableDate = new Date(tradableAfter);
  const now = new Date();
  const diff = tradableDate.getTime() - now.getTime();

  if (diff <= 0) return "ניתן למסחר";

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) {
    return `ניתן למסחר בעוד ${days}י:${hours}ש`;
  }
  return `ניתן למסחר בעוד ${hours}ש`;
}

export function getRarityColor(rarity: string): string {
  const colors: Record<string, string> = {
    "Consumer Grade": "#b0c3d9",
    "Industrial Grade": "#5e98d9",
    "Mil-Spec Grade": "#4b69ff",
    "Restricted": "#8847ff",
    "Classified": "#d32ce6",
    "Covert": "#eb4b4b",
    "Contraband": "#e4ae39",
    "Base Grade": "#b0c3d9",
    "High Grade": "#4b69ff",
    "Remarkable": "#8847ff",
    "Exotic": "#d32ce6",
    "Extraordinary": "#eb4b4b",
  };
  return colors[rarity] || "#b0c3d9";
}

// CS2 rarity order (highest to lowest)
// Special items (knives, gloves) and Contraband are highest
export const RARITY_ORDER: Record<string, number> = {
  // Contraband (e.g., M4A4 Howl)
  "Contraband": 10,

  // Knives & Gloves (gold/yellow rarity)
  "Extraordinary": 9,
  "Covert": 8,

  // Weapons
  "Classified": 7,
  "Restricted": 6,
  "Mil-Spec Grade": 5,
  "Mil-Spec": 5,

  // Industrial/Consumer
  "Industrial Grade": 4,
  "Consumer Grade": 3,

  // Stickers/Agents/Other
  "Exotic": 8,
  "Remarkable": 7,
  "High Grade": 5,
  "Base Grade": 3,

  // Default for unknown
  "Unknown": 0,
};

export function getRarityRank(rarity: string | undefined): number {
  if (!rarity) return 0;

  // Check exact match first
  if (RARITY_ORDER[rarity] !== undefined) {
    return RARITY_ORDER[rarity];
  }

  // Check if rarity contains any known keywords
  const rarityLower = rarity.toLowerCase();
  if (rarityLower.includes("contraband")) return 10;
  if (rarityLower.includes("covert") || rarityLower.includes("extraordinary")) return 8;
  if (rarityLower.includes("classified") || rarityLower.includes("exotic")) return 7;
  if (rarityLower.includes("restricted") || rarityLower.includes("remarkable")) return 6;
  if (rarityLower.includes("mil-spec") || rarityLower.includes("high grade")) return 5;
  if (rarityLower.includes("industrial")) return 4;
  if (rarityLower.includes("consumer") || rarityLower.includes("base grade")) return 3;

  return 0;
}

import type { InventoryItem } from "@/types/inventory";

// Items that DON'T have float values
const NON_FLOAT_KEYWORDS = [
  "case", "capsule", "key", "sticker", "graffiti", "patch", "pin", "music kit",
  "pass", "package", "gift", "name tag", "storage unit", "stat swap", "charm",
  "agent", "collectible", "medal", "coin", "trophy", "souvenir package"
];

// Items that DO have float values (weapon skins, knives, gloves)
const FLOAT_KEYWORDS = [
  "pistol", "rifle", "smg", "shotgun", "sniper", "machine gun", "knife", "gloves",
  "bayonet", "karambit", "flip", "gut", "falchion", "shadow daggers", "bowie",
  "butterfly", "huntsman", "navaja", "stiletto", "talon", "ursus", "classic",
  "paracord", "survival", "nomad", "skeleton", "kukri"
];

export function itemHasFloat(item: InventoryItem): boolean {
  const name = (item.name || "").toLowerCase();
  const marketName = (item.market_name || "").toLowerCase();
  const type = (item.type || "").toLowerCase();
  const combinedText = `${name} ${marketName} ${type}`;

  // Check if it's explicitly a non-float item
  for (const keyword of NON_FLOAT_KEYWORDS) {
    if (combinedText.includes(keyword)) {
      return false;
    }
  }

  // Check if it has a condition (items with conditions always have floats)
  if (item.condition) {
    return true;
  }

  // Check if the name contains condition indicators
  const conditionPatterns = /\((factory new|minimal wear|field-tested|well-worn|battle-scarred)\)/i;
  if (conditionPatterns.test(combinedText)) {
    return true;
  }

  // Check if it's a weapon type
  for (const keyword of FLOAT_KEYWORDS) {
    if (combinedText.includes(keyword)) {
      return true;
    }
  }

  // Check for weapon prefixes
  const weaponPrefixes = [
    "ak-47", "m4a4", "m4a1-s", "awp", "usp-s", "glock-18", "desert eagle", "p250",
    "five-seven", "tec-9", "cz75", "dual berettas", "r8 revolver", "p2000",
    "mp9", "mac-10", "mp7", "mp5-sd", "ump-45", "p90", "pp-bizon",
    "nova", "xm1014", "mag-7", "sawed-off", "negev", "m249",
    "famas", "galil ar", "sg 553", "aug", "ssg 08", "g3sg1", "scar-20"
  ];

  for (const prefix of weaponPrefixes) {
    if (combinedText.includes(prefix)) {
      return true;
    }
  }

  return false;
}

export function sortItemsByRarity(items: InventoryItem[]): InventoryItem[] {
  return [...items].sort((a, b) => {
    // Items with float (weapons, knives, gloves) come first
    const aHasFloat = itemHasFloat(a);
    const bHasFloat = itemHasFloat(b);

    if (aHasFloat !== bHasFloat) {
      return aHasFloat ? -1 : 1;
    }

    // Then sort by rarity (highest first)
    const rarityA = getRarityRank(a.rarity);
    const rarityB = getRarityRank(b.rarity);

    if (rarityB !== rarityA) {
      return rarityB - rarityA;
    }

    // If same rarity, sort by name
    return (a.name || "").localeCompare(b.name || "");
  });
}
