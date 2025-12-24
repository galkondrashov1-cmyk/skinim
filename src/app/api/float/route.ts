import { NextRequest, NextResponse } from "next/server";

const CSFLOAT_API_KEY = process.env.CSFLOAT_API_KEY || "f2c7niFBjkNqKU19Rm_QD34NBXTyIEDs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { inspectLink } = body;

    if (!inspectLink) {
      return NextResponse.json(
        { error: "Inspect link is required" },
        { status: 400 }
      );
    }

    // Extract parameters from inspect link
    // Format: steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20S76561198084749846A698323590D7935523998312483177
    const params = inspectLink.match(/[SADM]\d+/gi);
    if (!params || params.length < 3) {
      return NextResponse.json(
        { error: "Invalid inspect link format" },
        { status: 400 }
      );
    }

    // Try CSFloat API with browser-like headers
    const floatUrl = `https://api.csfloat.com/?url=${encodeURIComponent(inspectLink)}`;

    const floatResponse = await fetch(floatUrl, {
      headers: {
        "Authorization": CSFLOAT_API_KEY,
        "Origin": "https://csfloat.com",
        "Referer": "https://csfloat.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (floatResponse.ok) {
      const floatData = await floatResponse.json();
      return NextResponse.json({
        success: true,
        floatValue: floatData.iteminfo?.floatvalue || null,
        paintSeed: floatData.iteminfo?.paintseed || null,
        paintIndex: floatData.iteminfo?.paintindex || null,
        wearName: floatData.iteminfo?.wear_name || null,
      });
    }

    // Try alternative FloatDB API (public)
    const floatDbUrl = `https://floatdb.me/api/v1/float?url=${encodeURIComponent(inspectLink)}`;
    try {
      const floatDbResponse = await fetch(floatDbUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (floatDbResponse.ok) {
        const floatDbData = await floatDbResponse.json();
        if (floatDbData.floatvalue) {
          return NextResponse.json({
            success: true,
            floatValue: floatDbData.floatvalue || null,
            paintSeed: floatDbData.paintseed || null,
            paintIndex: floatDbData.paintindex || null,
            wearName: floatDbData.wear_name || null,
          });
        }
      }
    } catch {
      // FloatDB failed, continue to next fallback
    }

    // Fallback - try CSFloat without auth
    const publicResponse = await fetch(floatUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (publicResponse.ok) {
      const publicData = await publicResponse.json();
      return NextResponse.json({
        success: true,
        floatValue: publicData.iteminfo?.floatvalue || null,
        paintSeed: publicData.iteminfo?.paintseed || null,
        paintIndex: publicData.iteminfo?.paintindex || null,
        wearName: publicData.iteminfo?.wear_name || null,
      });
    }

    return NextResponse.json(
      { error: "Failed to fetch float value", floatValue: null },
      { status: 200 }
    );
  } catch (error) {
    console.error("Float fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch float value", floatValue: null },
      { status: 200 }
    );
  }
}
