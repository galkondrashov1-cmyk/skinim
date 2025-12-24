"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, FileText, ExternalLink, Sparkles, SlidersHorizontal, ChevronDown, X, ArrowUpDown } from "lucide-react";
import { Header } from "@/components/ui/header";
import { AnimatedBackground } from "@/components/ui/animated-background";
import { ItemCard } from "@/components/item-card";
import { ExportModal } from "@/components/export-modal";
import type { InventoryItem } from "@/types/inventory";
import { getConditionFromFloat, getRarityRank, sortItemsByRarity } from "@/lib/utils";

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
  "Knife", "Gloves", "Rifle", "Pistol", "SMG", "Shotgun", "Machine Gun",
];

const CONDITIONS = [
  { name: "Factory New", short: "FN", color: "#22c55e" },
  { name: "Minimal Wear", short: "MW", color: "#84cc16" },
  { name: "Field-Tested", short: "FT", color: "#eab308" },
  { name: "Well-Worn", short: "WW", color: "#f97316" },
  { name: "Battle-Scarred", short: "BS", color: "#ef4444" },
];

const SORT_OPTIONS = [
  { value: "rarity", label: "נדירות" },
  { value: "float_asc", label: "Float (נמוך לגבוה)" },
  { value: "float_desc", label: "Float (גבוה לנמוך)" },
  { value: "name", label: "שם" },
  { value: "type", label: "סוג נשק" },
];

function categorizeWeapon(type: string): string {
  const knives = ["Bayonet", "Karambit", "M9 Bayonet", "Butterfly Knife", "Flip Knife", "Gut Knife", "Huntsman Knife", "Falchion Knife", "Shadow Daggers", "Bowie Knife", "Navaja Knife", "Stiletto Knife", "Talon Knife", "Ursus Knife", "Classic Knife", "Paracord Knife", "Survival Knife", "Nomad Knife", "Skeleton Knife", "Kukri Knife"];
  const gloves = ["Sport Gloves", "Driver Gloves", "Hand Wraps", "Moto Gloves", "Specialist Gloves", "Hydra Gloves", "Bloodhound Gloves", "Broken Fang Gloves"];
  const rifles = ["AK-47", "M4A4", "M4A1-S", "AWP", "SG 553", "AUG", "FAMAS", "Galil AR", "SSG 08", "SCAR-20", "G3SG1"];
  const pistols = ["Glock-18", "USP-S", "P2000", "P250", "Five-SeveN", "Tec-9", "CZ75-Auto", "Dual Berettas", "Desert Eagle", "R8 Revolver"];
  const smgs = ["MP9", "MAC-10", "PP-Bizon", "MP7", "UMP-45", "P90", "MP5-SD"];
  const shotguns = ["Nova", "XM1014", "Sawed-Off", "MAG-7"];
  const machineGuns = ["M249", "Negev"];

  const typeLower = type?.toLowerCase() || "";
  if (knives.some(k => typeLower.includes(k.toLowerCase()))) return "Knife";
  if (gloves.some(g => typeLower.includes(g.toLowerCase()))) return "Gloves";
  if (rifles.some(r => type?.includes(r))) return "Rifle";
  if (pistols.some(p => type?.includes(p))) return "Pistol";
  if (smgs.some(s => type?.includes(s))) return "SMG";
  if (shotguns.some(s => type?.includes(s))) return "Shotgun";
  if (machineGuns.some(m => type?.includes(m))) return "Machine Gun";
  return "Other";
}

export default function Home() {
  const [tradeLink, setTradeLink] = useState("");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingFloats, setLoadingFloats] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRarity, setSelectedRarity] = useState<string | null>(null);
  const [selectedWeaponType, setSelectedWeaponType] = useState<string | null>(null);
  const [selectedCondition, setSelectedCondition] = useState<string | null>(null);
  const [floatMin, setFloatMin] = useState("");
  const [floatMax, setFloatMax] = useState("");
  const [sortBy, setSortBy] = useState("rarity");

  const fetchInventory = async (link: string) => {
    setLoading(true);
    setError(null);
    setItems([]);

    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeLink: link }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to fetch inventory");
      }

      const fetchedItems = data.items || [];
      setItems(fetchedItems);

      if (fetchedItems.length > 0) {
        saveItemsToDatabase(fetchedItems);
      }

      if (fetchedItems.length > 0) {
        fetchFloatValues(fetchedItems);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const saveItemsToDatabase = async (inventoryItems: InventoryItem[]) => {
    try {
      await fetch("/api/items/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: inventoryItems }),
      });
    } catch (error) {
      console.error("Error saving items to database:", error);
    }
  };

  const updateItemFloat = async (assetId: string, floatValue: number, paintSeed?: number) => {
    try {
      await fetch("/api/items/update-float", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, floatValue, paintSeed }),
      });
    } catch (error) {
      console.error("Error updating float:", error);
    }
  };

  const fetchFloatValues = async (inventoryItems: InventoryItem[]) => {
    const itemsWithInspect = inventoryItems.filter((item) => item.inspect_link);
    if (itemsWithInspect.length === 0) return;

    setLoadingFloats(true);

    const batchSize = 5;
    const updatedItems = [...inventoryItems];

    for (let i = 0; i < itemsWithInspect.length; i += batchSize) {
      const batch = itemsWithInspect.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (item) => {
          try {
            const res = await fetch("/api/float", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ inspectLink: item.inspect_link }),
            });

            const data = await res.json();

            if (data.floatValue) {
              const itemIndex = updatedItems.findIndex((i) => i.id === item.id);
              if (itemIndex !== -1) {
                updatedItems[itemIndex] = {
                  ...updatedItems[itemIndex],
                  float_value: data.floatValue,
                  paint_seed: data.paintSeed,
                  condition: updatedItems[itemIndex].condition || getConditionFromFloat(data.floatValue),
                };

                updateItemFloat(item.id, data.floatValue, data.paintSeed);
              }
            }
          } catch {
            // Silently fail for individual float fetches
          }
        })
      );

      setItems([...updatedItems]);

      if (i + batchSize < itemsWithInspect.length) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    setLoadingFloats(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tradeLink.trim()) {
      fetchInventory(tradeLink);
    }
  };

  // Filter and sort items
  const filteredAndSortedItems = useMemo(() => {
    let result = [...items];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(item =>
        item.name.toLowerCase().includes(query) ||
        item.market_name?.toLowerCase().includes(query) ||
        item.type?.toLowerCase().includes(query)
      );
    }

    // Apply rarity filter
    if (selectedRarity) {
      result = result.filter(item => item.rarity === selectedRarity);
    }

    // Apply weapon type filter
    if (selectedWeaponType) {
      result = result.filter(item => {
        const category = categorizeWeapon(item.type || item.name);
        return category === selectedWeaponType;
      });
    }

    // Apply condition filter
    if (selectedCondition) {
      result = result.filter(item => item.condition === selectedCondition);
    }

    // Apply float range filter
    if (floatMin) {
      const min = parseFloat(floatMin);
      if (!isNaN(min)) {
        result = result.filter(item => item.float_value !== undefined && item.float_value !== null && item.float_value >= min);
      }
    }
    if (floatMax) {
      const max = parseFloat(floatMax);
      if (!isNaN(max)) {
        result = result.filter(item => item.float_value !== undefined && item.float_value !== null && item.float_value <= max);
      }
    }

    // Apply sorting
    switch (sortBy) {
      case "rarity":
        result = sortItemsByRarity(result);
        break;
      case "float_asc":
        result.sort((a, b) => {
          if (a.float_value === null || a.float_value === undefined) return 1;
          if (b.float_value === null || b.float_value === undefined) return -1;
          return a.float_value - b.float_value;
        });
        break;
      case "float_desc":
        result.sort((a, b) => {
          if (a.float_value === null || a.float_value === undefined) return 1;
          if (b.float_value === null || b.float_value === undefined) return -1;
          return b.float_value - a.float_value;
        });
        break;
      case "name":
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "type":
        result.sort((a, b) => (a.type || "").localeCompare(b.type || ""));
        break;
    }

    return result;
  }, [items, searchQuery, selectedRarity, selectedWeaponType, selectedCondition, floatMin, floatMax, sortBy]);

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedRarity(null);
    setSelectedWeaponType(null);
    setSelectedCondition(null);
    setFloatMin("");
    setFloatMax("");
    setSortBy("rarity");
  };

  const activeFiltersCount = [
    selectedRarity,
    selectedWeaponType,
    selectedCondition,
    floatMin,
    floatMax,
  ].filter(Boolean).length;

  const tradableCount = filteredAndSortedItems.filter((i) => i.tradable).length;

  return (
    <div className="min-h-screen">
      <AnimatedBackground />

      <div className="relative z-10">
        <Header />

        <main className="mx-auto max-w-7xl px-4 py-8">
          {/* Hero Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto max-w-2xl text-center mb-8"
          >
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
              המאגר הכי גדול בישראל
            </h1>
            <p className="text-zinc-400">
              הכנס את ה-Trade Link שלך ונראה מה יש לך
            </p>
          </motion.div>

          {/* Search Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mx-auto max-w-2xl mb-12"
          >
            <div className="relative rounded-2xl border border-white/[0.08] bg-zinc-900/50 backdrop-blur-xl p-6 overflow-hidden">
              <div className="absolute -top-24 -right-24 w-48 h-48 bg-purple-500/20 rounded-full blur-3xl" />
              <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-pink-500/20 rounded-full blur-3xl" />

              <form onSubmit={handleSubmit} className="relative space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="https://steamcommunity.com/tradeoffer/new/?partner=..."
                    value={tradeLink}
                    onChange={(e) => setTradeLink(e.target.value)}
                    className="w-full px-4 py-3.5 rounded-xl border border-white/10 bg-black/40 text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 transition-all text-sm"
                    dir="ltr"
                  />
                </div>

                <a
                  href="https://steamcommunity.com/my/tradeoffers/privacy#trade_offer_access_url"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 text-xs text-zinc-500 hover:text-purple-400 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>איפה מוצאים את ה-Trade Link?</span>
                </a>

                <button
                  type="submit"
                  disabled={loading || !tradeLink.trim()}
                  className="w-full py-3.5 rounded-xl font-medium text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden group"
                  style={{
                    background: "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)",
                  }}
                >
                  <span className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                  <span className="relative flex items-center justify-center gap-2">
                    {loading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        טוען...
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4" />
                        שלוף פריטים
                      </>
                    )}
                  </span>
                </button>
              </form>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-center text-red-400 text-sm"
                >
                  {error}
                </motion.div>
              )}
            </div>
          </motion.div>

          {/* Results Section */}
          {(items.length > 0 || loading) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              {/* Stats & Controls Bar */}
              {items.length > 0 && (
                <div className="space-y-4 mb-6">
                  {/* Stats Row */}
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10">
                        <span className="text-sm text-zinc-400">סה״כ:</span>
                        <span className="font-bold text-white">{filteredAndSortedItems.length}</span>
                        {filteredAndSortedItems.length !== items.length && (
                          <span className="text-xs text-zinc-500">/ {items.length}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/20">
                        <span className="text-sm text-zinc-400">ניתן למסחר:</span>
                        <span className="font-bold text-green-400">{tradableCount}</span>
                      </div>
                      {loadingFloats && (
                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20">
                          <span className="w-3 h-3 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                          <span className="text-sm text-purple-400">טוען floats...</span>
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => setShowExport(true)}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-colors text-sm font-medium"
                    >
                      <FileText className="h-4 w-4" />
                      ייצא רשימה
                    </button>
                  </div>

                  {/* Search, Sort & Filter Row */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    {/* Search Input */}
                    <div className="relative flex-1">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                      <input
                        type="text"
                        placeholder="חפש פריט..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-white/10 bg-zinc-900/80 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-purple-500/50 backdrop-blur-sm"
                      />
                    </div>

                    {/* Sort Dropdown */}
                    <div className="relative">
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
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
                                    onClick={() => setSelectedRarity(selectedRarity === rarity.name ? null : rarity.name)}
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
                                    onClick={() => setSelectedWeaponType(selectedWeaponType === type ? null : type)}
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
                                    onClick={() => setSelectedCondition(selectedCondition === cond.name ? null : cond.name)}
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
                                    }
                                  }}
                                  className="flex-1 px-3 py-2 rounded-lg border border-white/10 bg-black/40 text-white text-xs font-mono text-center focus:outline-none focus:border-purple-500/50"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Loading State */}
              {loading && (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="w-12 h-12 border-3 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-4" />
                  <p className="text-zinc-400">טוען את האינוונטורי...</p>
                </div>
              )}

              {/* Items Grid */}
              {!loading && filteredAndSortedItems.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {filteredAndSortedItems.map((item, index) => (
                    <ItemCard
                      key={item.id}
                      item={{
                        id: item.id,
                        name: item.name,
                        market_hash_name: item.market_hash_name,
                        skin_name: item.market_name,
                        weapon_type: item.type,
                        rarity: item.rarity,
                        rarity_color: item.rarity_color,
                        condition: item.condition,
                        float_value: item.float_value,
                        paint_seed: item.paint_seed,
                        icon_url: item.icon_url,
                        icon_url_large: item.icon_url_large,
                        stickers: item.stickers,
                        tradable: item.tradable,
                      }}
                      index={index}
                    />
                  ))}
                </div>
              )}

              {/* No Results after filter */}
              {!loading && items.length > 0 && filteredAndSortedItems.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="text-5xl mb-4">🔍</div>
                  <h3 className="text-lg font-semibold text-white mb-1">לא נמצאו פריטים</h3>
                  <p className="text-zinc-500 text-sm">נסה לשנות את הפילטרים</p>
                </div>
              )}
            </motion.div>
          )}

          {/* Empty State */}
          {!loading && items.length === 0 && !error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-20 text-center"
            >
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/20 flex items-center justify-center mb-4">
                <Sparkles className="w-10 h-10 text-purple-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">
                מוכן לסרוק
              </h3>
              <p className="text-zinc-500 max-w-sm">
                הכנס את ה-Trade Link שלך למעלה כדי לראות את כל הפריטים שלך
              </p>
            </motion.div>
          )}
        </main>

        {/* Footer */}
        <footer className="border-t border-white/5 py-6 mt-12">
          <div className="mx-auto max-w-7xl px-4 text-center">
            <p className="text-sm text-zinc-600">
              SKINIM - המאגר הכי גדול בישראל לסוחרי CS2
            </p>
          </div>
        </footer>
      </div>

      <ExportModal isOpen={showExport} onClose={() => setShowExport(false)} items={filteredAndSortedItems} />
    </div>
  );
}
