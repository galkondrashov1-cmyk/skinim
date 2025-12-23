import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export async function query<T>(sql: string, params?: unknown[]): Promise<T> {
  const result = await client.execute({
    sql,
    args: (params || []) as (string | number | bigint | ArrayBuffer | null)[],
  });
  return result.rows as T;
}

export async function initDatabase() {
  // Main items table with collection field
  const createItemsTableSQL = `
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT UNIQUE NOT NULL,
      class_id TEXT,
      instance_id TEXT,
      name TEXT NOT NULL,
      market_hash_name TEXT,
      weapon_type TEXT,
      skin_name TEXT,
      rarity TEXT,
      rarity_color TEXT,
      condition_name TEXT,
      float_value REAL,
      paint_seed INTEGER,
      image_url TEXT,
      inspect_link TEXT,
      stickers TEXT,
      collection TEXT,
      tradable INTEGER DEFAULT 1,
      has_stickers INTEGER DEFAULT 0,
      sticker_count INTEGER DEFAULT 0,
      has_patches INTEGER DEFAULT 0,
      patch_count INTEGER DEFAULT 0,
      first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await client.execute(createItemsTableSQL);

  // Migration: Add new columns if they don't exist (for existing databases)
  const newColumns = [
    { name: "collection", type: "TEXT" },
    { name: "has_stickers", type: "INTEGER DEFAULT 0" },
    { name: "sticker_count", type: "INTEGER DEFAULT 0" },
    { name: "has_patches", type: "INTEGER DEFAULT 0" },
    { name: "patch_count", type: "INTEGER DEFAULT 0" },
  ];

  for (const col of newColumns) {
    try {
      await client.execute(`ALTER TABLE items ADD COLUMN ${col.name} ${col.type}`);
    } catch {
      // Column already exists, ignore error
    }
  }

  // Stickers on items table - for searching crafts by sticker
  const createItemStickersTableSQL = `
    CREATE TABLE IF NOT EXISTS item_stickers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_asset_id TEXT NOT NULL,
      sticker_name TEXT NOT NULL,
      sticker_url TEXT,
      slot INTEGER NOT NULL,
      wear REAL,
      type TEXT DEFAULT 'sticker',
      FOREIGN KEY (item_asset_id) REFERENCES items(asset_id)
    )
  `;

  // Migration: Add type column to item_stickers if not exists
  try {
    await client.execute("ALTER TABLE item_stickers ADD COLUMN type TEXT DEFAULT 'sticker'");
  } catch { /* Column already exists */ }

  await client.execute(createItemStickersTableSQL);

  // Stickers catalog table - all known stickers
  const createStickersCatalogSQL = `
    CREATE TABLE IF NOT EXISTS stickers_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      image_url TEXT,
      collection TEXT,
      rarity TEXT,
      tournament TEXT,
      team TEXT,
      type TEXT
    )
  `;

  await client.execute(createStickersCatalogSQL);

  // Create indexes for items (only if column exists)
  await client.execute("CREATE INDEX IF NOT EXISTS idx_rarity ON items(rarity)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_weapon_type ON items(weapon_type)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_condition ON items(condition_name)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_float ON items(float_value)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_name ON items(name)");

  // Try to create indexes for new columns (may fail if columns don't exist yet)
  try {
    await client.execute("CREATE INDEX IF NOT EXISTS idx_collection ON items(collection)");
  } catch { /* Column may not exist */ }

  try {
    await client.execute("CREATE INDEX IF NOT EXISTS idx_has_stickers ON items(has_stickers)");
  } catch { /* Column may not exist */ }

  try {
    await client.execute("CREATE INDEX IF NOT EXISTS idx_has_patches ON items(has_patches)");
  } catch { /* Column may not exist */ }

  // Create index for sticker type
  try {
    await client.execute("CREATE INDEX IF NOT EXISTS idx_item_stickers_type ON item_stickers(type)");
  } catch { /* Column may not exist */ }

  // Create indexes for item_stickers
  await client.execute("CREATE INDEX IF NOT EXISTS idx_item_stickers_asset ON item_stickers(item_asset_id)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_item_stickers_name ON item_stickers(sticker_name)");

  // Create indexes for stickers_catalog
  await client.execute("CREATE INDEX IF NOT EXISTS idx_stickers_name ON stickers_catalog(name)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_stickers_collection ON stickers_catalog(collection)");
}

export { client };
