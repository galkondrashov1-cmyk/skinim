"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Download, Copy, Check } from "lucide-react";
import { useState } from "react";
import type { InventoryItem } from "@/types/inventory";
import { ShinyButton } from "./ui/shiny-button";
import { getRarityRank, itemHasFloat } from "@/lib/utils";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
}

// Helper to strip condition from name
function stripConditionFromName(name: string): string {
  return name.replace(/\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i, '');
}

interface GroupedItem {
  name: string;
  condition: string;
  floatValue: string;
  count: number;
  rarity: string | undefined;
  rarityRank: number;
  hasFloat: boolean;
}

export function ExportModal({ isOpen, onClose, items }: ExportModalProps) {
  const [copied, setCopied] = useState(false);

  const generateExportText = () => {
    // Group identical items
    const groupedMap = new Map<string, GroupedItem>();

    for (const item of items) {
      const baseName = stripConditionFromName(item.market_name || item.name);
      const hasFloat = itemHasFloat(item);
      const condition = hasFloat ? (item.condition || "N/A") : "";
      const floatValue = hasFloat ? (item.float_value?.toFixed(10) || "N/A") : "";

      // Create key for grouping (same name, condition, and float = same item)
      const key = hasFloat
        ? `${baseName}|${condition}|${floatValue}`
        : `${baseName}|no-float`;

      if (groupedMap.has(key)) {
        const existing = groupedMap.get(key)!;
        existing.count += 1;
      } else {
        groupedMap.set(key, {
          name: baseName,
          condition,
          floatValue,
          count: 1,
          rarity: item.rarity,
          rarityRank: getRarityRank(item.rarity),
          hasFloat,
        });
      }
    }

    // Convert to array and sort:
    // 1. Items with float first (weapons, knives, gloves)
    // 2. Then by rarity (highest first)
    // 3. Then by name
    const groupedItems = Array.from(groupedMap.values()).sort((a, b) => {
      // Items with float come first
      if (a.hasFloat !== b.hasFloat) {
        return a.hasFloat ? -1 : 1;
      }

      // Then sort by rarity rank (highest first)
      if (b.rarityRank !== a.rarityRank) {
        return b.rarityRank - a.rarityRank;
      }

      // Then by name
      return a.name.localeCompare(b.name);
    });

    // Convert to lines
    const lines = groupedItems.map((grouped) => {
      const prefix = grouped.count > 1 ? `${grouped.count}x ` : "";

      if (grouped.hasFloat) {
        return `${prefix}${grouped.name} : ${grouped.condition} : ${grouped.floatValue}`;
      } else {
        // Items without float (cases, stickers, etc.) - just show name
        return `${prefix}${grouped.name}`;
      }
    });

    const uniqueCount = groupedMap.size;

    const header = [
      "═══════════════════════════════════════════════════════════════",
      "                    GAL'S INVENTORY EXPORT",
      `                    Generated: ${new Date().toLocaleString()}`,
      `                    Total Items: ${items.length} (${uniqueCount} unique)`,
      "═══════════════════════════════════════════════════════════════",
      "",
      "Format: [Qty] Item Name : Condition : Float Value",
      "(Sorted by rarity: highest first)",
      "───────────────────────────────────────────────────────────────",
      "",
    ].join("\n");

    const footer = [
      "",
      "───────────────────────────────────────────────────────────────",
      "                    End of Export",
      "═══════════════════════════════════════════════════════════════",
    ].join("\n");

    return header + lines.join("\n") + footer;
  };

  const exportText = generateExportText();

  const handleDownload = () => {
    const blob = new Blob([exportText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-export-${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(exportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-4 z-50 m-auto flex max-h-[90vh] max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 backdrop-blur-xl shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h2 className="text-xl font-bold text-white">ייצוא פריטים</h2>
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6">
              <pre className="whitespace-pre-wrap rounded-xl bg-black/50 p-4 font-mono text-sm text-zinc-300 border border-white/5">
                {exportText}
              </pre>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-white/10 px-6 py-4">
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-green-400" />
                    הועתק!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    העתק ללוח
                  </>
                )}
              </button>
              <ShinyButton onClick={handleDownload} className="flex items-center gap-2">
                <Download className="h-4 w-4" />
                הורד TXT
              </ShinyButton>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
