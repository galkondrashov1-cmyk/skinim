import { NextRequest, NextResponse } from "next/server";
import { client, initDatabase } from "@/lib/db";

const BUFF163_API_KEY = process.env.BUFF163_API_KEY;
const CNY_TO_USD_RATE = 0.14; // 1 CNY ≈ 0.14 USD
const CACHE_HOURS = 72; // Price cache validity in hours

// Check if price is still valid (within 72 hours)
function isPriceValid(updatedAt: string | null): boolean {
  if (!updatedAt) return false;
  const updateTime = new Date(updatedAt).getTime();
  const now = Date.now();
  const hoursDiff = (now - updateTime) / (1000 * 60 * 60);
  return hoursDiff < CACHE_HOURS;
}

// Get single item price from database
export async function GET(request: NextRequest) {
  const marketHashName = request.nextUrl.searchParams.get("market_hash_name");

  if (!marketHashName) {
    return NextResponse.json(
      { error: "market_hash_name is required" },
      { status: 400 }
    );
  }

  try {
    await initDatabase();

    // Get price from database
    const result = await client.execute({
      sql: `SELECT buff_price, buff_price_updated_at FROM prices WHERE market_hash_name = ?`,
      args: [marketHashName],
    });

    if (result.rows.length > 0 && result.rows[0].buff_price) {
      const price = result.rows[0].buff_price as number;
      const updatedAt = result.rows[0].buff_price_updated_at as string | null;
      const isValid = isPriceValid(updatedAt);

      return NextResponse.json({
        price,
        price_usd: price * CNY_TO_USD_RATE,
        updated_at: updatedAt,
        is_stale: !isValid // Flag to indicate if price needs refresh
      });
    }

    return NextResponse.json({ price: null, price_usd: null });
  } catch (error) {
    console.error("Error fetching price:", error);
    return NextResponse.json({ error: "Failed to fetch price" }, { status: 500 });
  }
}

// Sync ALL prices from Buff163 API (call this periodically)
export async function POST(request: NextRequest) {
  const { action } = await request.json().catch(() => ({}));

  if (action === "sync") {
    return syncAllPrices();
  }

  if (action === "stats") {
    return getPriceStats();
  }

  // Batch get prices from database
  try {
    await initDatabase();
    const { marketHashNames } = await request.json();

    if (!Array.isArray(marketHashNames) || marketHashNames.length === 0) {
      return NextResponse.json({ error: "marketHashNames array is required" }, { status: 400 });
    }

    const names = marketHashNames.slice(0, 100);
    const placeholders = names.map(() => "?").join(",");
    const result = await client.execute({
      sql: `SELECT market_hash_name, buff_price FROM prices WHERE market_hash_name IN (${placeholders})`,
      args: names,
    });

    const prices: Record<string, { cny: number | null; usd: number | null }> = {};
    for (const row of result.rows) {
      const cnyPrice = row.buff_price as number | null;
      prices[row.market_hash_name as string] = {
        cny: cnyPrice,
        usd: cnyPrice ? cnyPrice * CNY_TO_USD_RATE : null
      };
    }

    for (const name of names) {
      if (!(name in prices)) {
        prices[name] = { cny: null, usd: null };
      }
    }

    return NextResponse.json({ prices });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Failed to fetch prices" }, { status: 500 });
  }
}

// Sync all prices from Buff163
async function syncAllPrices() {
  if (!BUFF163_API_KEY) {
    return NextResponse.json({ error: "BUFF163_API_KEY not configured" }, { status: 500 });
  }

  try {
    await initDatabase();

    // Fetch ALL items from Buff163 - include_sticker=0 returns all items without stickers/graffiti
    const response = await fetch(
      `https://buff.163.com/api/market/items?game=cs2&include_sticker=0`,
      {
        headers: {
          "Authorization": `Bearer ${BUFF163_API_KEY}`,
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error(`Buff163 API error: ${response.status}`, text);
      return NextResponse.json({ error: `API error: ${response.status}`, details: text }, { status: response.status });
    }

    const data = await response.json();

    if (!data.info || !Array.isArray(data.info)) {
      return NextResponse.json({ error: "Invalid response format", data }, { status: 500 });
    }

    // Prepare items for batch insert
    const itemsToInsert: { name: string; price: number }[] = [];

    for (const item of data.info) {
      if (!item.market_hash_name || !item.sales || item.sales.length === 0) continue;

      // Get lowest price from all sales (first sale with non-zero price)
      let minPrice: number | null = null;
      for (const sale of item.sales) {
        const price = parseFloat(sale.min_price);
        if (!isNaN(price) && price > 0 && (minPrice === null || price < minPrice)) {
          minPrice = price;
        }
      }

      if (minPrice !== null) {
        itemsToInsert.push({ name: item.market_hash_name, price: minPrice });
      }
    }

    // Batch insert in chunks of 100
    const BATCH_SIZE = 100;
    let savedCount = 0;

    for (let i = 0; i < itemsToInsert.length; i += BATCH_SIZE) {
      const batch = itemsToInsert.slice(i, i + BATCH_SIZE);

      // Build batch insert SQL
      const values = batch.map(() => "(?, ?, datetime('now'))").join(", ");
      const args: (string | number)[] = [];
      for (const item of batch) {
        args.push(item.name, item.price);
      }

      await client.execute({
        sql: `INSERT INTO prices (market_hash_name, buff_price, buff_price_updated_at)
              VALUES ${values}
              ON CONFLICT(market_hash_name) DO UPDATE SET
              buff_price = excluded.buff_price,
              buff_price_updated_at = excluded.buff_price_updated_at`,
        args,
      });

      savedCount += batch.length;
    }

    return NextResponse.json({
      success: true,
      items_synced: savedCount,
      total_items: data.info.length,
      remaining_requests: data.req_remaining
    });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json({ error: "Sync failed", details: String(error) }, { status: 500 });
  }
}

// Get price statistics
async function getPriceStats() {
  try {
    await initDatabase();

    // Get total prices count
    const totalResult = await client.execute({
      sql: `SELECT COUNT(*) as total FROM prices WHERE buff_price IS NOT NULL`,
      args: [],
    });

    // Get stale prices count (older than 72 hours)
    const staleResult = await client.execute({
      sql: `SELECT COUNT(*) as stale FROM prices
            WHERE buff_price IS NOT NULL
            AND datetime(buff_price_updated_at) < datetime('now', '-${CACHE_HOURS} hours')`,
      args: [],
    });

    // Get last sync time
    const lastSyncResult = await client.execute({
      sql: `SELECT MAX(buff_price_updated_at) as last_sync FROM prices`,
      args: [],
    });

    const total = totalResult.rows[0]?.total as number || 0;
    const stale = staleResult.rows[0]?.stale as number || 0;
    const lastSync = lastSyncResult.rows[0]?.last_sync as string | null;

    return NextResponse.json({
      total_prices: total,
      stale_prices: stale,
      fresh_prices: total - stale,
      last_sync: lastSync,
      cache_hours: CACHE_HOURS,
      needs_sync: stale > 0 || total === 0
    });
  } catch (error) {
    console.error("Error getting stats:", error);
    return NextResponse.json({ error: "Failed to get stats" }, { status: 500 });
  }
}
