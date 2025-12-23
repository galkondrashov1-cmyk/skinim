import { NextRequest, NextResponse } from "next/server";
import { query, initDatabase, client } from "@/lib/db";

interface DatabaseItem {
  id: number;
  asset_id: string;
  class_id: string;
  instance_id: string;
  name: string;
  market_hash_name: string;
  weapon_type: string;
  skin_name: string;
  rarity: string;
  rarity_color: string;
  condition_name: string;
  float_value: number | null;
  paint_seed: number | null;
  image_url: string;
  inspect_link: string;
  stickers: string | null;
  collection: string | null;
  tradable: boolean;
  has_stickers: number;
  sticker_count: number;
  has_patches: number;
  patch_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export async function GET(request: NextRequest) {
  try {
    await initDatabase();

    const searchParams = request.nextUrl.searchParams;

    // Get filter parameters
    const rarity = searchParams.get("rarity");
    const weaponType = searchParams.get("weapon_type");
    const condition = searchParams.get("condition");
    const floatMin = searchParams.get("float_min");
    const floatMax = searchParams.get("float_max");
    const search = searchParams.get("search");
    const collection = searchParams.get("collection");
    const hasStickers = searchParams.get("has_stickers");
    const hasPatches = searchParams.get("has_patches");
    const stickerName = searchParams.get("sticker"); // Search for specific sticker
    const patchName = searchParams.get("patch"); // Search for specific patch
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    const sort = searchParams.get("sort") || "rarity_desc";

    // Build query
    const conditions: string[] = [];
    const params: unknown[] = [];
    let useJoin = false;

    if (rarity) {
      conditions.push("items.rarity = ?");
      params.push(rarity);
    }

    if (weaponType) {
      conditions.push("items.weapon_type = ?");
      params.push(weaponType);
    }

    if (condition) {
      conditions.push("items.condition_name = ?");
      params.push(condition);
    }

    if (floatMin) {
      conditions.push("items.float_value >= ?");
      params.push(parseFloat(floatMin));
    }

    if (floatMax) {
      conditions.push("items.float_value <= ?");
      params.push(parseFloat(floatMax));
    }

    if (search) {
      conditions.push("(items.name LIKE ? OR items.skin_name LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    if (collection) {
      conditions.push("items.collection = ?");
      params.push(collection);
    }

    if (hasStickers === "true") {
      conditions.push("items.has_stickers = 1");
    }

    if (hasPatches === "true") {
      conditions.push("items.has_patches = 1");
    }

    // If searching by sticker name, we need to join with item_stickers table
    if (stickerName) {
      useJoin = true;
      conditions.push("item_stickers.sticker_name LIKE ?");
      conditions.push("item_stickers.type = 'sticker'");
      params.push(`%${stickerName}%`);
    }

    // If searching by patch name
    if (patchName) {
      useJoin = true;
      conditions.push("item_stickers.sticker_name LIKE ?");
      conditions.push("item_stickers.type = 'patch'");
      params.push(`%${patchName}%`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Parse sort parameter (format: "column_direction" e.g., "rarity_desc", "float_asc")
    const sortMapping: Record<string, { column: string; order: string }> = {
      rarity_desc: { column: "rarity", order: "DESC" },
      rarity_asc: { column: "rarity", order: "ASC" },
      float_asc: { column: "float_value", order: "ASC" },
      float_desc: { column: "float_value", order: "DESC" },
      name_asc: { column: "name", order: "ASC" },
      name_desc: { column: "name", order: "DESC" },
      type_asc: { column: "weapon_type", order: "ASC" },
      type_desc: { column: "weapon_type", order: "DESC" },
      newest: { column: "last_seen_at", order: "DESC" },
      oldest: { column: "first_seen_at", order: "ASC" },
      stickers_desc: { column: "sticker_count", order: "DESC" },
      stickers_asc: { column: "sticker_count", order: "ASC" },
    };

    const sortConfig = sortMapping[sort] || sortMapping["rarity_desc"];
    const safeSort = sortConfig.column;
    const safeOrder = sortConfig.order;

    // Build FROM clause based on whether we need to join
    const fromClause = useJoin
      ? "FROM items INNER JOIN item_stickers ON items.asset_id = item_stickers.item_asset_id"
      : "FROM items";

    // Get total count
    const countSql = useJoin
      ? `SELECT COUNT(DISTINCT items.asset_id) as total ${fromClause} ${whereClause}`
      : `SELECT COUNT(*) as total ${fromClause} ${whereClause}`;
    const countResult = await query<[{ total: number }]>(countSql, params);
    const total = countResult[0]?.total || 0;

    // Get items with pagination
    const offset = (page - 1) * limit;
    const selectClause = useJoin ? "SELECT DISTINCT items.*" : "SELECT *";
    const itemsSql = `
      ${selectClause} ${fromClause}
      ${whereClause}
      ORDER BY items.${safeSort} ${safeOrder}
      LIMIT ? OFFSET ?
    `;

    const items = await query<DatabaseItem[]>(itemsSql, [...params, limit, offset]);

    // Parse stickers JSON
    const parsedItems = items.map((item) => ({
      ...item,
      stickers: item.stickers ? JSON.parse(item.stickers) : null,
    }));

    return NextResponse.json({
      items: parsedItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching items:", error);
    return NextResponse.json(
      { error: "Failed to fetch items from database" },
      { status: 500 }
    );
  }
}

// Get list of all stickers for autocomplete
export async function POST(request: NextRequest) {
  try {
    await initDatabase();
    const { action } = await request.json();

    if (action === "get_stickers") {
      const stickers = await query<{ name: string; image_url: string }[]>(
        "SELECT DISTINCT name, image_url FROM stickers_catalog ORDER BY name LIMIT 500"
      );
      return NextResponse.json({ stickers });
    }

    if (action === "get_collections") {
      const result = await client.execute(
        "SELECT DISTINCT collection FROM items WHERE collection IS NOT NULL ORDER BY collection"
      );
      const collections = result.rows.map((row) => row.collection as string);
      return NextResponse.json({ collections });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}
