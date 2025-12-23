"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Database, Home } from "lucide-react";
import { cn } from "@/lib/utils";

export function Header() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isDatabase = pathname === "/database";

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-black/40 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="group flex items-center gap-2">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="relative"
            >
              <span className="text-2xl md:text-3xl font-black tracking-tight">
                <span className="bg-gradient-to-r from-purple-400 via-pink-500 to-orange-400 bg-clip-text text-transparent animate-gradient bg-[length:200%_auto]">
                  SKINIM
                </span>
              </span>
              <span className="absolute -top-1 -right-8 text-[10px] font-medium text-purple-400/80 bg-purple-500/10 px-1.5 py-0.5 rounded">
                IL
              </span>
            </motion.div>
          </Link>

          {/* Navigation */}
          <nav className="flex items-center gap-1">
            <NavLink href="/" active={isHome}>
              <Home className="h-4 w-4" />
              <span className="hidden sm:inline">בית</span>
            </NavLink>
            <NavLink href="/database" active={isDatabase}>
              <Database className="h-4 w-4" />
              <span className="hidden sm:inline">מאגר</span>
            </NavLink>
          </nav>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200",
        active
          ? "text-white"
          : "text-zinc-400 hover:text-white hover:bg-white/5"
      )}
    >
      {active && (
        <motion.div
          layoutId="nav-active"
          className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30"
          transition={{ type: "spring", duration: 0.5 }}
        />
      )}
      <span className="relative flex items-center gap-2">{children}</span>
    </Link>
  );
}
