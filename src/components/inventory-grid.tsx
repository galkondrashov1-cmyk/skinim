"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import type { InventoryItem } from "@/types/inventory";
import { InventoryItemCard } from "./inventory-item-card";
import { Spinner } from "./ui/spinner";
import { TextShimmer } from "./ui/text-shimmer";
import { sortItemsByRarity } from "@/lib/utils";

interface InventoryGridProps {
  items: InventoryItem[];
  loading?: boolean;
  loadingFloats?: boolean;
}

export function InventoryGrid({ items, loading, loadingFloats }: InventoryGridProps) {
  // Sort items by rarity (highest first)
  const sortedItems = useMemo(() => sortItemsByRarity(items), [items]);
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <TextShimmer
          as="h2"
          className="text-3xl font-bold [--base-color:#a855f7] [--base-gradient-color:#ffffff]"
          duration={1.5}
        >
          טוען פריטים...
        </TextShimmer>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center py-20 text-center"
      >
        <div className="text-6xl mb-4">📦</div>
        <h3 className="text-xl font-semibold text-white mb-2">לא נמצאו פריטים</h3>
        <p className="text-zinc-400 max-w-md">
          הכנס קישור מסחר Steam למעלה או התחבר עם Steam כדי לצפות בפריטים שלך.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-4">
      {loadingFloats && (
        <div className="flex items-center gap-2 text-sm text-purple-400">
          <Spinner size="sm" />
          <span>טוען float values...</span>
        </div>
      )}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
      >
        {sortedItems.map((item, index) => (
          <InventoryItemCard key={item.id} item={item} index={index} />
        ))}
      </motion.div>
    </div>
  );
}
