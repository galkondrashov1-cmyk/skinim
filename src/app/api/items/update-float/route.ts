import { NextResponse } from "next/server";
import { client } from "@/lib/db";
import { getConditionFromFloat } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const { assetId, floatValue, paintSeed } = await request.json();

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
