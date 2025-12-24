import { NextRequest, NextResponse } from "next/server";
import { client } from "@/lib/db";

const BUFF163_API_KEY = process.env.BUFF163_API_KEY;

interface BuffPriceResponse {
  code: string;
  data: {
    items: Array<{
      market_hash_name: string;
      sell_min_price: string;
      sell_num: number;
      buy_max_price: string;
      buy_num: number;
    }>;
  };
}

// Cache for prices (in memory, resets on server restart)
const priceCache: Map<string, { price: number; timestamp: number }> = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function GET(request: NextRequest) {
  const marketHashName = request.nextUrl.searchParams.get("market_hash_name");

  if (!marketHashName) {
    return NextResponse.json(
      { error: "market_hash_name is required" },
      { status: 400 }
    );
  }

  // Check cache first
  const cached = priceCache.get(marketHashName);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json({ price: cached.price, cached: true });
  }

  try {
    // Try to get from database first
    const dbResult = await client.execute({
      sql: `SELECT buff_price, buff_price_updated_at FROM prices WHERE market_hash_name = ?`,
      args: [marketHashName],
    });

    if (dbResult.rows.length > 0) {
      const row = dbResult.rows[0];
      const updatedAt = new Date(row.buff_price_updated_at as string).getTime();

      // If price is less than 1 hour old, return it
      if (Date.now() - updatedAt < 60 * 60 * 1000) {
        const price = row.buff_price as number;
        priceCache.set(marketHashName, { price, timestamp: Date.now() });
        return NextResponse.json({ price, cached: true });
      }
    }

    // Fetch from Buff163 API
    const response = await fetch(
      `https://buff.163.com/api/market/goods?game=csgo&page_num=1&search=${encodeURIComponent(marketHashName)}`,
      {
        headers: {
          Cookie: `session=${BUFF163_API_KEY}`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Buff163 API error: ${response.status}`);
    }

    const data: BuffPriceResponse = await response.json();

    if (data.code !== "OK" || !data.data?.items?.length) {
      return NextResponse.json({ price: null, error: "Item not found on Buff" });
    }

    // Find exact match
    const item = data.data.items.find(
      (i) => i.market_hash_name === marketHashName
    );

    if (!item) {
      return NextResponse.json({ price: null, error: "Exact item not found" });
    }

    const price = parseFloat(item.sell_min_price);

    // Save to database
    await client.execute({
      sql: `INSERT INTO prices (market_hash_name, buff_price, buff_price_updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(market_hash_name) DO UPDATE SET
            buff_price = excluded.buff_price,
            buff_price_updated_at = excluded.buff_price_updated_at`,
      args: [marketHashName, price],
    });

    // Update cache
    priceCache.set(marketHashName, { price, timestamp: Date.now() });

    return NextResponse.json({ price, cached: false });
  } catch (error) {
    console.error("Error fetching Buff price:", error);
    return NextResponse.json(
      { error: "Failed to fetch price" },
      { status: 500 }
    );
  }
}

// Batch price fetch for multiple items
export async function POST(request: NextRequest) {
  try {
    const { marketHashNames } = await request.json();

    if (!Array.isArray(marketHashNames) || marketHashNames.length === 0) {
      return NextResponse.json(
        { error: "marketHashNames array is required" },
        { status: 400 }
      );
    }

    // Limit to 50 items per request
    const names = marketHashNames.slice(0, 50);

    // Get prices from database
    const placeholders = names.map(() => "?").join(",");
    const result = await client.execute({
      sql: `SELECT market_hash_name, buff_price FROM prices WHERE market_hash_name IN (${placeholders})`,
      args: names,
    });

    const prices: Record<string, number | null> = {};
    for (const row of result.rows) {
      prices[row.market_hash_name as string] = row.buff_price as number;
    }

    // Fill in missing with null
    for (const name of names) {
      if (!(name in prices)) {
        prices[name] = null;
      }
    }

    return NextResponse.json({ prices });
  } catch (error) {
    console.error("Error fetching batch prices:", error);
    return NextResponse.json(
      { error: "Failed to fetch prices" },
      { status: 500 }
    );
  }
}
