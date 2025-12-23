"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ShinyButtonProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}

export function ShinyButton({
  children,
  className,
  onClick,
  disabled,
  type = "button",
}: ShinyButtonProps) {
  return (
    <motion.button
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      disabled={disabled}
      type={type}
      className={cn(
        "relative overflow-hidden rounded-lg px-6 py-3 font-medium transition-shadow duration-300 ease-in-out",
        "hover:shadow-[0_0_30px_rgba(139,92,246,0.3)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
      style={{
        background:
          "linear-gradient(135deg, rgba(99, 102, 241, 0.9) 0%, rgba(168, 85, 247, 0.9) 50%, rgba(236, 72, 153, 0.9) 100%)",
      }}
    >
      <span className="relative z-10 flex items-center justify-center gap-2 text-sm font-semibold tracking-wide text-white">
        {children}
      </span>
      <motion.div
        className="absolute inset-0 z-0"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)",
        }}
        animate={{
          x: ["-100%", "100%"],
        }}
        transition={{
          repeat: Infinity,
          repeatType: "loop",
          duration: 2,
          ease: "linear",
        }}
      />
    </motion.button>
  );
}
