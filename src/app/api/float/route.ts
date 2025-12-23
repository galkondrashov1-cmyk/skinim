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

    // Try CSFloat API
    const floatUrl = `https://api.csfloat.com/?url=${encodeURIComponent(inspectLink)}`;

    const floatResponse = await fetch(floatUrl, {
      headers: {
        "Authorization": CSFLOAT_API_KEY,
      },
    });

    if (!floatResponse.ok) {
      // Fallback - try without auth for public endpoint
      const publicResponse = await fetch(floatUrl);

      if (!publicResponse.ok) {
        return NextResponse.json(
          { error: "Failed to fetch float value", floatValue: null },
          { status: 200 }
        );
      }

      const publicData = await publicResponse.json();
      return NextResponse.json({
        success: true,
        floatValue: publicData.iteminfo?.floatvalue || null,
        paintSeed: publicData.iteminfo?.paintseed || null,
        paintIndex: publicData.iteminfo?.paintindex || null,
        wearName: publicData.iteminfo?.wear_name || null,
      });
    }

    const floatData = await floatResponse.json();

    return NextResponse.json({
      success: true,
      floatValue: floatData.iteminfo?.floatvalue || null,
      paintSeed: floatData.iteminfo?.paintseed || null,
      paintIndex: floatData.iteminfo?.paintindex || null,
      wearName: floatData.iteminfo?.wear_name || null,
    });
  } catch (error) {
    console.error("Float fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch float value", floatValue: null },
      { status: 200 }
    );
  }
}
