import { NextResponse } from "next/server";
import { initDatabase, client } from "@/lib/db";
import type { InventoryItem, Sticker } from "@/types/inventory";

// Parse weapon type and skin name from item name
function parseItemName(name: string): { weaponType: string; skinName: string } {
  // Handle special items like keys, cases, stickers
  if (!name.includes("|")) {
    return { weaponType: "Other", skinName: name };
  }

  const parts = name.split("|").map((p) => p.trim());
  const weaponType = parts[0];
  let skinName = parts[1] || "";

  // Remove condition from skin name
  skinName = skinName
    .replace(
      /\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i,
      ""
    )
    .trim();

  return { weaponType, skinName };
}

// Extract collection from item name or type
function extractCollection(name: string, marketHashName: string): string | null {
  // Common collections mapping based on skin names
  const collectionPatterns: Record<string, string> = {
    "Asiimov": "The Phoenix Collection",
    "Dragon Lore": "The Cobblestone Collection",
    "Howl": "The Huntsman Collection",
    "Fire Serpent": "The Bravo Collection",
    "Redline": "The Phoenix Collection",
    "Vulcan": "The Huntsman Collection",
    "Hyper Beast": "The Falchion Collection",
    "Neon Rider": "The Prisma Collection",
    "Printstream": "The Control Collection",
    "Fade": "The Assault Collection",
    "Doppler": "The Chroma Collection",
    "Tiger Tooth": "The Chroma Collection",
    "Marble Fade": "The Chroma 2 Collection",
    "Crimson Web": "The Bravo Collection",
    "Slaughter": "The Assault Collection",
  };

  for (const [pattern, collection] of Object.entries(collectionPatterns)) {
    if (name.includes(pattern) || marketHashName.includes(pattern)) {
      return collection;
    }
  }

  return null;
}

// Categorize weapon type
function categorizeWeapon(weaponType: string): string {
  const knives = [
    "Bayonet",
    "Karambit",
    "M9 Bayonet",
    "Butterfly Knife",
    "Flip Knife",
    "Gut Knife",
    "Huntsman Knife",
    "Falchion Knife",
    "Shadow Daggers",
    "Bowie Knife",
    "Navaja Knife",
    "Stiletto Knife",
    "Talon Knife",
    "Ursus Knife",
    "Classic Knife",
    "Paracord Knife",
    "Survival Knife",
    "Nomad Knife",
    "Skeleton Knife",
    "Kukri Knife",
  ];

  const gloves = [
    "Sport Gloves",
    "Driver Gloves",
    "Hand Wraps",
    "Moto Gloves",
    "Specialist Gloves",
    "Hydra Gloves",
    "Bloodhound Gloves",
    "Broken Fang Gloves",
  ];

  const rifles = [
    "AK-47",
    "M4A4",
    "M4A1-S",
    "AWP",
    "SG 553",
    "AUG",
    "FAMAS",
    "Galil AR",
    "SSG 08",
    "SCAR-20",
    "G3SG1",
  ];

  const pistols = [
    "Glock-18",
    "USP-S",
    "P2000",
    "P250",
    "Five-SeveN",
    "Tec-9",
    "CZ75-Auto",
    "Dual Berettas",
    "Desert Eagle",
    "R8 Revolver",
  ];

  const smgs = ["MP9", "MAC-10", "PP-Bizon", "MP7", "UMP-45", "P90", "MP5-SD"];

  const shotguns = ["Nova", "XM1014", "Sawed-Off", "MAG-7"];

  const machineGuns = ["M249", "Negev"];

  if (knives.some((k) => weaponType.toLowerCase().includes(k.toLowerCase())))
    return "Knife";
  if (gloves.some((g) => weaponType.toLowerCase().includes(g.toLowerCase())))
    return "Gloves";
  if (rifles.includes(weaponType)) return "Rifle";
  if (pistols.includes(weaponType)) return "Pistol";
  if (smgs.includes(weaponType)) return "SMG";
  if (shotguns.includes(weaponType)) return "Shotgun";
  if (machineGuns.includes(weaponType)) return "Machine Gun";

  return "Other";
}

// Check weapon type including agents
function getItemCategory(name: string, weaponType: string): string {
  if (isAgent(name)) {
    return "Agent";
  }
  return categorizeWeapon(weaponType);
}

// Check if item is an agent
function isAgent(name: string): boolean {
  const lowerName = name.toLowerCase();
  // Agents typically have names like "Master Agent | Ava" or faction names
  const agentPatterns = [
    "master agent",
    "special agent",
    "elite agent",
    "operator",
    "cmdr.",
    "lt. commander",
    "sergeant",
    "lieutenant",
    "officer",
    "agent ava",
    "vypa",
    "romanov",
    "safecracker",
    "buckshot",
    "anarchist",
    "professional",
    "ground rebel",
    "street soldier",
    "phoenix",
    "elite crew",
    "sas",
    "gign",
    "fbi",
    "seal frogman",
    "swat",
    "nswc seal",
    "tacp cavalry",
    "two times",
    "getaway sally",
    "little kev",
    "number k",
    "sir bloody",
    "chem-haz",
    "bio-haz",
    "dragomir",
    "rezan",
    "maximus",
    "osiris",
    "shahmat",
    "'blueberries' buckshot",
    "chef d'escadron",
    "chem-haz capitaine",
    "sous-lieutenant medic",
    "aspirant",
    "jungle rebel",
  ];

  for (const pattern of agentPatterns) {
    if (lowerName.includes(pattern)) {
      return true;
    }
  }

  return false;
}

// Check if item should be saved to database (skins, knives, gloves, agents with patches)
function shouldSaveItem(name: string, category: string, hasPatches: boolean): boolean {
  const lowerName = name.toLowerCase();

  // Exclude containers, cases, keys, stickers, patches (standalone), graffiti, music kits, pins, coins
  const excludePatterns = [
    "case",
    "container",
    "key",
    "sticker |", // Only exclude standalone stickers, not stickers on items
    "graffiti",
    "music kit",
    "pin",
    "coin",
    "medal",
    "capsule",
    "package",
    "pass",
    "viewer",
    "souvenir package",
    "gift",
    "tool",
    "name tag",
    "storage unit",
    "stat swap",
  ];

  // Check if it's a standalone patch (not an agent with patches)
  if (lowerName.includes("patch |") && !isAgent(name)) {
    return false;
  }

  for (const pattern of excludePatterns) {
    if (lowerName.includes(pattern)) {
      return false;
    }
  }

  // Save agents ONLY if they have at least one patch
  if (isAgent(name)) {
    return hasPatches;
  }

  // Only save if it's a weapon skin, knife, or gloves
  const validCategories = ["Knife", "Gloves", "Rifle", "Pistol", "SMG", "Shotgun", "Machine Gun"];

  // If it has a skin name (contains "|") and is a valid category, save it
  if (name.includes("|") && validCategories.includes(category)) {
    return true;
  }

  // Knives and gloves should always be saved
  if (category === "Knife" || category === "Gloves") {
    return true;
  }

  return false;
}

// Check if a sticker is actually a patch
// Patches have "Patch |" in their name, like "Patch | Metal Unicorn"
function isPatchByName(stickerName: string): boolean {
  const lowerName = stickerName.toLowerCase();
  return lowerName.startsWith("patch |") || lowerName.includes(" patch");
}

// Count stickers and patches separately
// If the item is an agent, ALL applied items are patches (agents can only have patches)
// If the item is a weapon, ALL applied items are stickers (weapons can only have stickers)
function countStickersAndPatches(stickers: Sticker[], isAgentItem: boolean): { stickerCount: number; patchCount: number } {
  if (isAgentItem) {
    // Agents only have patches
    return { stickerCount: 0, patchCount: stickers.length };
  } else {
    // Weapons only have stickers
    return { stickerCount: stickers.length, patchCount: 0 };
  }
}

// Save stickers to item_stickers table with type distinction
async function saveItemStickers(assetId: string, stickers: Sticker[], isAgentItem: boolean) {
  // First, delete existing stickers for this item
  await client.execute({
    sql: "DELETE FROM item_stickers WHERE item_asset_id = ?",
    args: [assetId],
  });

  // Determine type based on item category
  // Agents have patches, weapons have stickers
  const stickerType = isAgentItem ? "patch" : "sticker";

  // Insert new stickers with type
  for (const sticker of stickers) {
    await client.execute({
      sql: `INSERT INTO item_stickers (item_asset_id, sticker_name, sticker_url, slot, type)
            VALUES (?, ?, ?, ?, ?)`,
      args: [assetId, sticker.name, sticker.icon_url || null, sticker.slot, stickerType],
    });

    // Also add to stickers catalog if not exists
    try {
      await client.execute({
        sql: `INSERT OR IGNORE INTO stickers_catalog (name, image_url, type) VALUES (?, ?, ?)`,
        args: [sticker.name, sticker.icon_url || null, stickerType],
      });
    } catch {
      // Ignore if sticker already exists in catalog
    }
  }
}

export async function POST(request: Request) {
  try {
    const { items } = (await request.json()) as { items: InventoryItem[] };

    if (!items || !Array.isArray(items)) {
      return NextResponse.json(
        { error: "Invalid items array" },
        { status: 400 }
      );
    }

    // Initialize database table if not exists
    await initDatabase();

    let savedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const item of items) {
      const { weaponType, skinName } = parseItemName(item.name);
      const category = getItemCategory(item.name, weaponType);
      const hasPatches = item.stickers && item.stickers.length > 0;

      // Skip items that shouldn't be saved (cases, stickers, agents without patches, etc.)
      if (!shouldSaveItem(item.name, category, hasPatches || false)) {
        skippedCount++;
        continue;
      }

      const collection = extractCollection(item.name, item.market_hash_name || item.name);
      const isAgentItem = isAgent(item.name);

      // Count stickers and patches separately
      const { stickerCount, patchCount } = item.stickers
        ? countStickersAndPatches(item.stickers, isAgentItem)
        : { stickerCount: 0, patchCount: 0 };

      const hasStickersFlag = stickerCount > 0 ? 1 : 0;
      const hasPatchesFlag = patchCount > 0 ? 1 : 0;

      // Use INSERT OR REPLACE for SQLite (Turso)
      const sql = `
        INSERT OR REPLACE INTO items (
          asset_id, class_id, instance_id, name, market_hash_name,
          weapon_type, skin_name, rarity, rarity_color, condition_name,
          float_value, paint_seed, image_url, inspect_link, stickers,
          collection, tradable, has_stickers, sticker_count, has_patches, patch_count,
          first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          COALESCE((SELECT first_seen_at FROM items WHERE asset_id = ?), CURRENT_TIMESTAMP),
          CURRENT_TIMESTAMP
        )
      `;

      const params = [
        item.id, // asset_id
        item.classid || null,
        item.instanceid || null,
        item.name,
        item.market_hash_name || item.name,
        category,
        skinName,
        item.rarity || null,
        item.rarity_color || null,
        item.condition || null,
        item.float_value || null,
        item.paint_seed || null,
        item.icon_url || null,
        item.inspect_link || null,
        item.stickers ? JSON.stringify(item.stickers) : null,
        collection,
        item.tradable ? 1 : 0,
        hasStickersFlag,
        stickerCount,
        hasPatchesFlag,
        patchCount,
        item.id, // for the COALESCE subquery
      ];

      try {
        const result = await client.execute({
          sql,
          args: params,
        });

        if (result.rowsAffected > 0) {
          savedCount++;
        }

        // Save stickers to separate table for search functionality
        if (item.stickers && item.stickers.length > 0) {
          await saveItemStickers(item.id, item.stickers, isAgentItem);
        }
      } catch {
        // Item might already exist, count as update
        updatedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      saved: savedCount,
      updated: updatedCount,
      skipped: skippedCount,
      total: items.length,
    });
  } catch (error) {
    console.error("Error saving items:", error);
    return NextResponse.json(
      { error: "Failed to save items to database" },
      { status: 500 }
    );
  }
}
