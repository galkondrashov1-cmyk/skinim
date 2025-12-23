export interface InventoryItem {
  id: string;
  classid: string;
  instanceid: string;
  name: string;
  market_name: string;
  market_hash_name: string;
  icon_url: string;
  icon_url_large?: string;
  tradable: boolean;
  tradable_after?: string | null;
  marketable: boolean;
  type: string;
  rarity?: string;
  rarity_color?: string;
  float_value?: number;
  condition?: string;
  inspect_link?: string;
  stickers?: Sticker[];
  paint_seed?: number;
}

export interface Sticker {
  name: string;
  icon_url: string;
  slot: number;
}

export interface SteamInventoryResponse {
  success: boolean;
  assets?: SteamAsset[];
  descriptions?: SteamDescription[];
  total_inventory_count?: number;
  error?: string;
}

export interface SteamAsset {
  appid: number;
  contextid: string;
  assetid: string;
  classid: string;
  instanceid: string;
  amount: string;
}

export interface SteamDescription {
  appid: number;
  classid: string;
  instanceid: string;
  name: string;
  market_name: string;
  market_hash_name: string;
  icon_url: string;
  icon_url_large?: string;
  tradable: number;
  marketable: number;
  type: string;
  descriptions?: { type: string; value: string }[];
  tags?: SteamTag[];
  actions?: { link: string; name: string }[];
  owner_descriptions?: { type: string; value: string }[];
}

export interface SteamTag {
  category: string;
  internal_name: string;
  localized_category_name: string;
  localized_tag_name: string;
  color?: string;
}

export interface FloatResponse {
  iteminfo?: {
    floatvalue: number;
    paintindex: number;
    paintseed: number;
    wear_name: string;
    full_item_name: string;
    stickers?: {
      name: string;
      slot: number;
    }[];
  };
}

export interface ExportData {
  items: ExportItem[];
  generated_at: string;
  steam_id: string;
}

export interface ExportItem {
  name: string;
  condition: string;
  float_value: string;
  trade_status: string;
}
