import { NextRequest, NextResponse } from "next/server";
import {
  extractSteamIdFromTradeLink,
} from "@/lib/utils";
import type {
  InventoryItem,
  SteamDescription,
  SteamAsset,
} from "@/types/inventory";

const STEAM_API_KEY = process.env.STEAM_API_KEY;

// Method 1: Direct Steam Community API (works in dev, might be blocked in production)
async function fetchSteamInventoryDirect(steamId: string): Promise<any> {
  const url = `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=5000`;

  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://steamcommunity.com/",
      "Origin": "https://steamcommunity.com",
    },
    cache: "no-store",
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    throw new Error(`Steam returned ${response.status}`);
  }

  return response.json();
}

// Method 2: Use a CORS proxy that works with Steam
async function fetchSteamInventoryViaProxy(steamId: string): Promise<any> {
  // Try multiple proxies
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=5000`)}`,
    `https://api.codetabs.com/v1/proxy?quest=https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=5000`,
  ];

  for (const proxyUrl of proxies) {
    try {
      const response = await fetch(proxyUrl, {
        headers: {
          "Accept": "application/json",
        },
        cache: "no-store",
      });

      if (response.ok) {
        const text = await response.text();
        if (text && text.startsWith("{")) {
          return JSON.parse(text);
        }
      }
    } catch (e) {
      console.log(`Proxy failed: ${proxyUrl}`, e);
      continue;
    }
  }

  throw new Error("All proxies failed");
}

// Main fetch function - tries multiple methods
async function fetchSteamInventory(steamId: string): Promise<any> {
  // Try direct first
  try {
    console.log("Trying direct Steam fetch...");
    return await fetchSteamInventoryDirect(steamId);
  } catch (directError) {
    console.log("Direct fetch failed:", directError);
  }

  // Try proxy as fallback
  try {
    console.log("Trying proxy fetch...");
    return await fetchSteamInventoryViaProxy(steamId);
  } catch (proxyError) {
    console.log("Proxy fetch failed:", proxyError);
  }

  throw new Error("Unable to fetch inventory from Steam");
}

// Validate Steam ID using Steam Web API
async function validateSteamId(steamId: string): Promise<boolean> {
  if (!STEAM_API_KEY) return true;

  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamId}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    return data.response?.players?.length > 0;
  } catch {
    return true;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tradeLink, steamId } = body;

    let targetSteamId = steamId;

    if (tradeLink && !steamId) {
      targetSteamId = extractSteamIdFromTradeLink(tradeLink);
      if (!targetSteamId) {
        return NextResponse.json(
          { error: "Invalid trade link format" },
          { status: 400 }
        );
      }
    }

    if (!targetSteamId) {
      return NextResponse.json(
        { error: "Steam ID or trade link required" },
        { status: 400 }
      );
    }

    console.log("Fetching inventory for Steam ID:", targetSteamId);

    // Validate Steam ID exists
    const isValid = await validateSteamId(targetSteamId);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid Steam ID" },
        { status: 400 }
      );
    }

    // Fetch inventory
    const inventoryData = await fetchSteamInventory(targetSteamId);
    console.log("Assets count:", inventoryData.assets?.length || 0);

    const items = processInventoryData(inventoryData, targetSteamId);

    if (items.length > 0) {
      console.log(`SUCCESS: ${items.length} items for Steam ID ${targetSteamId}`);
      return NextResponse.json({
        success: true,
        items,
        total: items.length,
        steamId: targetSteamId,
        source: "steam",
      });
    }

    return NextResponse.json({
      error: "No items found. Make sure the Steam inventory is PUBLIC.",
    }, { status: 404 });

  } catch (error) {
    console.error("Inventory fetch error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (errorMessage.includes("403") || errorMessage.includes("401")) {
      return NextResponse.json(
        { error: "האינוונטורי פרטי. ודא שהאינוונטורי מוגדר כציבורי." },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: "שגיאה בטעינת האינוונטורי. נסה שוב." },
      { status: 500 }
    );
  }
}

function processInventoryData(inventoryData: any, steamId: string): InventoryItem[] {
  const items: InventoryItem[] = [];

  if (!inventoryData.assets || !inventoryData.descriptions) {
    return items;
  }

  const assets: SteamAsset[] = inventoryData.assets;
  const descriptions: SteamDescription[] = inventoryData.descriptions;

  const descriptionMap = new Map<string, SteamDescription>();
  descriptions.forEach((desc) => {
    const key = `${desc.classid}_${desc.instanceid}`;
    descriptionMap.set(key, desc);
  });

  for (const asset of assets) {
    const key = `${asset.classid}_${asset.instanceid}`;
    const description = descriptionMap.get(key);

    if (!description) continue;

    let rarity = "";
    let rarityColor = "";
    if (description.tags) {
      const rarityTag = description.tags.find(
        (t) => t.category === "Rarity" || t.category === "Quality"
      );
      if (rarityTag) {
        rarity = rarityTag.localized_tag_name;
        rarityColor = rarityTag.color ? `#${rarityTag.color}` : "";
      }
    }

    let inspectLink = "";
    if (description.actions) {
      const inspectAction = description.actions.find((a) =>
        a.link.includes("csgo_econ_action_preview")
      );
      if (inspectAction) {
        inspectLink = inspectAction.link
          .replace("%owner_steamid%", steamId)
          .replace("%assetid%", asset.assetid);
      }
    }

    items.push({
      id: asset.assetid,
      classid: asset.classid,
      instanceid: asset.instanceid,
      name: description.name,
      market_name: description.market_name,
      market_hash_name: description.market_hash_name,
      icon_url: `https://community.akamai.steamstatic.com/economy/image/${description.icon_url}`,
      icon_url_large: description.icon_url_large
        ? `https://community.akamai.steamstatic.com/economy/image/${description.icon_url_large}`
        : undefined,
      tradable: description.tradable === 1,
      marketable: description.marketable === 1,
      type: description.type,
      rarity,
      rarity_color: rarityColor,
      inspect_link: inspectLink || undefined,
    });
  }

  return items;
}
