import { NextResponse } from "next/server";
import { client, initDatabase } from "@/lib/db";
import { getConditionFromFloat } from "@/lib/utils";

const CSFLOAT_API_KEY = process.env.CSFLOAT_API_KEY || "f2c7niFBjkNqKU19Rm_QD34NBXTyIEDs";

// Update single item float
export async function POST(request: Request) {
  try {
    const { assetId, floatValue, paintSeed, action } = await request.json();

    // Bulk update action - fetch missing floats
    if (action === "bulk_update") {
      return bulkUpdateFloats();
    }

    if (!assetId || floatValue === undefined) {
      return NextResponse.json(
        { error: "Missing assetId or floatValue" },
        { status: 400 }
      );
    }

    const condition = getConditionFromFloat(floatValue);

    await client.execute({
      sql: `UPDATE items
            SET float_value = ?, paint_seed = ?, condition_name = ?
            WHERE asset_id = ?`,
      args: [floatValue, paintSeed || null, condition, assetId],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating float:", error);
    return NextResponse.json(
      { error: "Failed to update float" },
      { status: 500 }
    );
  }
}

// Fetch float from CSFloat API
async function fetchFloat(inspectLink: string): Promise<{ floatValue: number | null; paintSeed: number | null }> {
  try {
    const floatUrl = `https://api.csfloat.com/?url=${encodeURIComponent(inspectLink)}`;

    // Use proper headers for CSFloat API
    const response = await fetch(floatUrl, {
      headers: {
        "Authorization": CSFLOAT_API_KEY,
        "Origin": "https://csfloat.com",
        "Referer": "https://csfloat.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        floatValue: data.iteminfo?.floatvalue || null,
        paintSeed: data.iteminfo?.paintseed || null,
      };
    }

    // Try alternative FloatDB API
    try {
      const floatDbUrl = `https://floatdb.me/api/v1/float?url=${encodeURIComponent(inspectLink)}`;
      const floatDbResponse = await fetch(floatDbUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (floatDbResponse.ok) {
        const floatDbData = await floatDbResponse.json();
        if (floatDbData.floatvalue) {
          return {
            floatValue: floatDbData.floatvalue || null,
            paintSeed: floatDbData.paintseed || null,
          };
        }
      }
    } catch {
      // FloatDB failed
    }

    // Fallback - CSFloat without auth
    const publicResponse = await fetch(floatUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (publicResponse.ok) {
      const data = await publicResponse.json();
      return {
        floatValue: data.iteminfo?.floatvalue || null,
        paintSeed: data.iteminfo?.paintseed || null,
      };
    }

    return { floatValue: null, paintSeed: null };
  } catch {
    return { floatValue: null, paintSeed: null };
  }
}

// Bulk update all items missing float values
async function bulkUpdateFloats() {
  try {
    await initDatabase();

    // Get items with inspect_link but no float_value (weapons only, not cases/stickers/agents)
    const result = await client.execute({
      sql: `SELECT asset_id, inspect_link FROM items
            WHERE float_value IS NULL
            AND inspect_link IS NOT NULL
            AND weapon_type NOT IN ('Other', 'Agent', 'Sticker', 'Graffiti', 'Container', 'Music Kit', 'Collectible')
            LIMIT 50`,
      args: [],
    });

    if (result.rows.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No items need float update",
        updated: 0
      });
    }

    let updated = 0;
    let failed = 0;

    for (const row of result.rows) {
      const assetId = row.asset_id as string;
      const inspectLink = row.inspect_link as string;

      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

      const { floatValue, paintSeed } = await fetchFloat(inspectLink);

      if (floatValue !== null) {
        const condition = getConditionFromFloat(floatValue);
        await client.execute({
          sql: `UPDATE items SET float_value = ?, paint_seed = ?, condition_name = ? WHERE asset_id = ?`,
          args: [floatValue, paintSeed, condition, assetId],
        });
        updated++;
      } else {
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Updated ${updated} items, ${failed} failed`,
      updated,
      failed,
      remaining: result.rows.length - updated - failed,
    });
  } catch (error) {
    console.error("Bulk update error:", error);
    return NextResponse.json(
      { error: "Bulk update failed", details: String(error) },
      { status: 500 }
    );
  }
}

// GET - Check how many items need float update
export async function GET() {
  try {
    await initDatabase();

    const result = await client.execute({
      sql: `SELECT COUNT(*) as count FROM items
            WHERE float_value IS NULL
            AND inspect_link IS NOT NULL
            AND weapon_type NOT IN ('Other', 'Agent', 'Sticker', 'Graffiti', 'Container', 'Music Kit', 'Collectible')`,
      args: [],
    });

    const count = result.rows[0]?.count as number || 0;

    return NextResponse.json({
      items_missing_float: count,
      message: count > 0
        ? `${count} items need float update. POST with action: "bulk_update" to update.`
        : "All items have float values",
    });
  } catch (error) {
    console.error("Error checking floats:", error);
    return NextResponse.json(
      { error: "Failed to check floats" },
      { status: 500 }
    );
  }
}
