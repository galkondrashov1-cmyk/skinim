"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  ChevronDown,
  ArrowUpDown,
} from "lucide-react";
import { Header } from "@/components/ui/header";
import { AnimatedBackground } from "@/components/ui/animated-background";
import { ItemCard } from "@/components/item-card";

interface StickerData {
  name: string;
  icon_url: string;
  slot: number;
}

interface DatabaseItem {
  id: number;
  asset_id: string;
  name: string;
  market_hash_name?: string;
  weapon_type: string;
  skin_name: string;
  rarity: string;
  rarity_color: string;
  condition_name: string;
  float_value: number | null;
  paint_seed: number | null;
  image_url: string;
  inspect_link?: string;
  stickers: StickerData[] | null;
  collection: string | null;
  has_stickers: number;
  sticker_count: number;
  has_patches: number;
  patch_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

interface Stats {
  total: number;
  uniqueItems: number;
  itemsWithFloat: number;
  byRarity: Record<string, number>;
  byWeaponType: Record<string, number>;
  byCondition: Record<string, number>;
}

const RARITIES = [
  { name: "Contraband", color: "#e4ae39" },
  { name: "Covert", color: "#eb4b4b" },
  { name: "Classified", color: "#d32ee6" },
  { name: "Restricted", color: "#8847ff" },
  { name: "Mil-Spec Grade", color: "#4b69ff" },
  { name: "Industrial Grade", color: "#5e98d9" },
  { name: "Consumer Grade", color: "#b0c3d9" },
];

const WEAPON_TYPES = [
  "Knife",
  "Gloves",
  "Rifle",
  "Pistol",
  "SMG",
  "Shotgun",
  "Machine Gun",
];

const CONDITIONS = [
  { name: "Factory New", short: "FN", color: "#22c55e" },
  { name: "Minimal Wear", short: "MW", color: "#84cc16" },
  { name: "Field-Tested", short: "FT", color: "#eab308" },
  { name: "Well-Worn", short: "WW", color: "#f97316" },
  { name: "Battle-Scarred", short: "BS", color: "#ef4444" },
];

const SORT_OPTIONS = [
  { value: "rarity_desc", label: "נדירות (גבוה לנמוך)" },
  { value: "rarity_asc", label: "נדירות (נמוך לגבוה)" },
  { value: "float_asc", label: "Float (נמוך לגבוה)" },
  { value: "float_desc", label: "Float (גבוה לנמוך)" },
  { value: "name_asc", label: "שם (א-ת)" },
  { value: "name_desc", label: "שם (ת-א)" },
  { value: "newest", label: "חדש ביותר" },
  { value: "oldest", label: "ישן ביותר" },
];

export default function DatabasePage() {
  const [items, setItems] = useState<DatabaseItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedRarity, setSelectedRarity] = useState<string | null>(null);
  const [selectedWeaponType, setSelectedWeaponType] = useState<string | null>(null);
  const [selectedCondition, setSelectedCondition] = useState<string | null>(null);
  const [floatMin, setFloatMin] = useState("");
  const [floatMax, setFloatMax] = useState("");
  const [hasStickersOnly, setHasStickersOnly] = useState(false);
  const [stickerSearch, setStickerSearch] = useState("");
  const [sortBy, setSortBy] = useState("rarity_desc");

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/items/stats");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStats(data);
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
  };

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", "48");

      if (search) params.set("search", search);
      if (selectedRarity) params.set("rarity", selectedRarity);
      if (selectedWeaponType) params.set("weapon_type", selectedWeaponType);
      if (selectedCondition) params.set("condition", selectedCondition);
      if (floatMin) params.set("float_min", floatMin);
      if (floatMax) params.set("float_max", floatMax);
      if (hasStickersOnly) params.set("has_stickers", "true");
      if (stickerSearch) params.set("sticker", stickerSearch);
      if (sortBy) params.set("sort", sortBy);

      const res = await fetch(`/api/items?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setItems(data.items);
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
    } catch (error) {
      console.error("Error fetching items:", error);
    } finally {
      setLoading(false);
    }
  }, [
    page,
    search,
    selectedRarity,
    selectedWeaponType,
    selectedCondition,
    floatMin,
    floatMax,
    hasStickersOnly,
    stickerSearch,
    sortBy,
  ]);

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchItems();
    }, 400);
    return () => clearTimeout(timer);
  }, [fetchItems]);

  const clearFilters = () => {
    setSearch("");
    setSelectedRarity(null);
    setSelectedWeaponType(null);
    setSelectedCondition(null);
    setFloatMin("");
    setFloatMax("");
    setHasStickersOnly(false);
    setStickerSearch("");
    setSortBy("rarity_desc");
    setPage(1);
  };

  const activeFiltersCount = [
    selectedRarity,
    selectedWeaponType,
    selectedCondition,
    floatMin,
    floatMax,
    hasStickersOnly,
    stickerSearch,
  ].filter(Boolean).length;

  return (
    <div className="min-h-screen">
      <AnimatedBackground />

      <div className="relative z-10">
        <Header />

        <main className="mx-auto max-w-7xl px-4 py-6">
          {/* Top Bar - Stats & Search & Filters */}
          <div className="flex flex-col gap-4 mb-6">
            {/* Stats Row */}
            {stats && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
                  <span className="text-xs text-zinc-500">סה״כ</span>
                  <span className="text-sm font-bold text-white">{stats.total.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <span className="text-xs text-zinc-500">סכינים</span>
                  <span className="text-sm font-bold text-purple-400">{stats.byWeaponType["Knife"] || 0}</span>
                </div>
              </div>
            )}

            {/* Search & Filter Row */}
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Search Input */}
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <input
                  type="text"
                  placeholder="חפש פריט..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-white/10 bg-zinc-900/80 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-purple-500/50 backdrop-blur-sm"
                />
              </div>

              {/* Sort Dropdown */}
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value);
                    setPage(1);
                  }}
                  className="appearance-none px-4 py-2.5 pr-10 rounded-xl border border-white/10 bg-zinc-900/80 text-white text-sm focus:outline-none focus:border-purple-500/50 cursor-pointer"
                >
                  {SORT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
              </div>

              {/* Filter Button */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                  showFilters || activeFiltersCount > 0
                    ? "border-purple-500/50 bg-purple-500/20 text-purple-300"
                    : "border-white/10 bg-zinc-900/80 text-white hover:bg-white/5"
                }`}
              >
                <SlidersHorizontal className="h-4 w-4" />
                <span>פילטרים</span>
                {activeFiltersCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-purple-500 text-white text-xs min-w-[20px]">
                    {activeFiltersCount}
                  </span>
                )}
                <ChevronDown className={`h-4 w-4 transition-transform ${showFilters ? "rotate-180" : ""}`} />
              </button>

              {/* Clear Filters */}
              {activeFiltersCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-red-400 hover:bg-red-500/10 transition-colors text-sm"
                >
                  <X className="h-4 w-4" />
                  <span className="hidden sm:inline">נקה</span>
                </button>
              )}
            </div>

            {/* Expandable Filters Panel */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 rounded-xl border border-white/10 bg-zinc-900/80 backdrop-blur-xl space-y-4">
                    {/* Row 1: Rarity & Weapon Type */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Rarity */}
                      <div>
                        <label className="text-xs font-medium text-zinc-400 mb-2 block">נדירות</label>
                        <div className="flex flex-wrap gap-1.5">
                          {RARITIES.map((rarity) => (
                            <button
                              key={rarity.name}
                              onClick={() => {
                                setSelectedRarity(selectedRarity === rarity.name ? null : rarity.name);
                                setPage(1);
                              }}
                              className={`px-2.5 py-1.5 text-[11px] rounded-lg border transition-all ${
                                selectedRarity === rarity.name
                                  ? "border-current bg-current/20"
                                  : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20"
                              }`}
                              style={{
                                borderColor: selectedRarity === rarity.name ? rarity.color : undefined,
                                color: selectedRarity === rarity.name ? rarity.color : undefined,
                              }}
                            >
                              {rarity.name.replace(" Grade", "")}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Weapon Type */}
                      <div>
                        <label className="text-xs font-medium text-zinc-400 mb-2 block">סוג</label>
                        <div className="flex flex-wrap gap-1.5">
                          {WEAPON_TYPES.map((type) => (
                            <button
                              key={type}
                              onClick={() => {
                                setSelectedWeaponType(selectedWeaponType === type ? null : type);
                                setPage(1);
                              }}
                              className={`px-2.5 py-1.5 text-[11px] rounded-lg border transition-all ${
                                selectedWeaponType === type
                                  ? "border-purple-500 bg-purple-500/20 text-white"
                                  : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20"
                              }`}
                            >
                              {type}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Row 2: Condition & Float Range */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Condition */}
                      <div>
                        <label className="text-xs font-medium text-zinc-400 mb-2 block">מצב</label>
                        <div className="flex flex-wrap gap-1.5">
                          {CONDITIONS.map((cond) => (
                            <button
                              key={cond.name}
                              onClick={() => {
                                setSelectedCondition(selectedCondition === cond.name ? null : cond.name);
                                setPage(1);
                              }}
                              className={`px-3 py-1.5 text-[11px] rounded-lg border transition-all ${
                                selectedCondition === cond.name
                                  ? "border-current bg-current/20"
                                  : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20"
                              }`}
                              style={{
                                borderColor: selectedCondition === cond.name ? cond.color : undefined,
                                color: selectedCondition === cond.name ? cond.color : undefined,
                              }}
                            >
                              {cond.short}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Float Range */}
                      <div>
                        <label className="text-xs font-medium text-zinc-400 mb-2 block">טווח Float</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="0.00"
                            value={floatMin}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "" || /^\d*\.?\d*$/.test(val)) {
                                setFloatMin(val);
                                setPage(1);
                              }
                            }}
                            className="flex-1 px-3 py-2 rounded-lg border border-white/10 bg-black/40 text-white text-xs font-mono text-center focus:outline-none focus:border-purple-500/50"
                          />
                          <span className="text-zinc-600">-</span>
                          <input
                            type="text"
                            placeholder="1.00"
                            value={floatMax}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "" || /^\d*\.?\d*$/.test(val)) {
                                setFloatMax(val);
                                setPage(1);
                              }
                            }}
                            className="flex-1 px-3 py-2 rounded-lg border border-white/10 bg-black/40 text-white text-xs font-mono text-center focus:outline-none focus:border-purple-500/50"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Row 3: Stickers Only */}
                    <div>
                      <label className="text-xs font-medium text-zinc-400 mb-2 block">מדבקות</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="חפש מדבקה..."
                          value={stickerSearch}
                          onChange={(e) => {
                            setStickerSearch(e.target.value);
                            setPage(1);
                          }}
                          className="flex-1 px-3 py-2 rounded-lg border border-white/10 bg-black/40 text-white text-xs placeholder-zinc-600 focus:outline-none focus:border-purple-500/50"
                        />
                        <button
                          onClick={() => {
                            setHasStickersOnly(!hasStickersOnly);
                            setPage(1);
                          }}
                          className={`px-3 py-2 text-[11px] rounded-lg border transition-all whitespace-nowrap ${
                            hasStickersOnly
                              ? "border-purple-500 bg-purple-500/20 text-purple-400"
                              : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20"
                          }`}
                        >
                          עם מדבקות
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Results Count */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-zinc-400">
              נמצאו <span className="text-white font-semibold">{total.toLocaleString()}</span> פריטים
            </p>
          </div>

          {/* Loading State */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-10 h-10 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-4" />
              <p className="text-zinc-500 text-sm">טוען פריטים...</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="text-5xl mb-4">📦</div>
              <h3 className="text-lg font-semibold text-white mb-1">לא נמצאו פריטים</h3>
              <p className="text-zinc-500 text-sm">נסה לשנות את הפילטרים</p>
            </div>
          ) : (
            <>
              {/* Items Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {items.map((item, index) => (
                  <ItemCard
                    key={item.id}
                    item={{
                      id: item.id,
                      asset_id: item.asset_id,
                      name: item.name,
                      market_hash_name: item.market_hash_name,
                      skin_name: item.skin_name,
                      weapon_type: item.weapon_type,
                      rarity: item.rarity,
                      rarity_color: item.rarity_color,
                      condition_name: item.condition_name,
                      float_value: item.float_value,
                      paint_seed: item.paint_seed,
                      image_url: item.image_url,
                      inspect_link: item.inspect_link,
                      stickers: item.stickers,
                      sticker_count: item.sticker_count,
                      patch_count: item.patch_count,
                    }}
                    index={index}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-8">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10 transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                    הקודם
                  </button>
                  <div className="flex items-center gap-1">
                    {[...Array(Math.min(5, totalPages))].map((_, i) => {
                      let pageNum: number;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (page <= 3) {
                        pageNum = i + 1;
                      } else if (page >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = page - 2 + i;
                      }
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setPage(pageNum)}
                          className={`w-9 h-9 rounded-lg text-sm font-medium transition-all ${
                            page === pageNum
                              ? "bg-purple-500 text-white"
                              : "text-zinc-400 hover:bg-white/10"
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10 transition-colors"
                  >
                    הבא
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
