import { NextResponse } from "next/server";
import { query, initDatabase } from "@/lib/db";

interface StatsRow {
  category: string;
  count: number;
}

export async function GET() {
  try {
    await initDatabase();

    // Get total items count
    const totalResult = await query<[{ total: number }]>(
      "SELECT COUNT(*) as total FROM items"
    );
    const total = totalResult[0]?.total || 0;

    // Get count by rarity
    const rarityStats = await query<StatsRow[]>(`
      SELECT rarity as category, COUNT(*) as count
      FROM items
      WHERE rarity IS NOT NULL
      GROUP BY rarity
      ORDER BY count DESC
    `);

    // Get count by weapon type
    const weaponTypeStats = await query<StatsRow[]>(`
      SELECT weapon_type as category, COUNT(*) as count
      FROM items
      WHERE weapon_type IS NOT NULL
      GROUP BY weapon_type
      ORDER BY count DESC
    `);

    // Get count by condition
    const conditionStats = await query<StatsRow[]>(`
      SELECT condition_name as category, COUNT(*) as count
      FROM items
      WHERE condition_name IS NOT NULL
      GROUP BY condition_name
      ORDER BY count DESC
    `);

    // Get unique items count (by name)
    const uniqueResult = await query<[{ unique_count: number }]>(
      "SELECT COUNT(DISTINCT name) as unique_count FROM items"
    );
    const uniqueItems = uniqueResult[0]?.unique_count || 0;

    // Get items with float values
    const floatResult = await query<[{ float_count: number }]>(
      "SELECT COUNT(*) as float_count FROM items WHERE float_value IS NOT NULL"
    );
    const itemsWithFloat = floatResult[0]?.float_count || 0;

    return NextResponse.json({
      total,
      uniqueItems,
      itemsWithFloat,
      byRarity: Object.fromEntries(
        rarityStats.map((r) => [r.category, r.count])
      ),
      byWeaponType: Object.fromEntries(
        weaponTypeStats.map((r) => [r.category, r.count])
      ),
      byCondition: Object.fromEntries(
        conditionStats.map((r) => [r.category, r.count])
      ),
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch statistics" },
      { status: 500 }
    );
  }
}
