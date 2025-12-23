"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface GlowingInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export const GlowingInput = forwardRef<HTMLInputElement, GlowingInputProps>(
  ({ className, ...props }, ref) => {
    return (
      <div className="relative w-full">
        <motion.div
          className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 opacity-30 blur-lg transition-opacity group-hover:opacity-50"
          animate={{
            backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
          }}
          transition={{
            duration: 5,
            repeat: Infinity,
            repeatType: "reverse",
          }}
        />
        <input
          ref={ref}
          className={cn(
            "relative w-full rounded-xl border border-white/10 bg-zinc-900/90 px-6 py-4 text-white placeholder:text-zinc-500",
            "focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50",
            "transition-all duration-300 text-center",
            className
          )}
          {...props}
        />
      </div>
    );
  }
);

GlowingInput.displayName = "GlowingInput";
