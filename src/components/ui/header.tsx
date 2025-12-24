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
          <Link href="/" className="group flex items-center gap-3">
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative w-10 h-10 flex items-center justify-center"
            >
              {/* Gun icon with Israeli flag colors */}
              <svg viewBox="0 0 40 40" className="w-full h-full">
                {/* Background circle with gradient */}
                <defs>
                  <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#a855f7" />
                    <stop offset="50%" stopColor="#ec4899" />
                    <stop offset="100%" stopColor="#f97316" />
                  </linearGradient>
                </defs>
                <circle cx="20" cy="20" r="18" fill="url(#logoGradient)" opacity="0.2" />
                <circle cx="20" cy="20" r="18" stroke="url(#logoGradient)" strokeWidth="2" fill="none" />
                {/* AK-47 silhouette */}
                <path
                  d="M8 22 L14 22 L15 20 L18 20 L19 18 L28 18 L29 20 L32 20 L32 22 L30 24 L28 24 L26 22 L20 22 L18 24 L14 24 L12 22 Z"
                  fill="url(#logoGradient)"
                />
                {/* Star of David small accent */}
                <path
                  d="M31 12 L33 15 L31 18 L29 15 Z M29 12 L31 15 L33 12 L31 9 Z"
                  fill="#60a5fa"
                  opacity="0.8"
                  transform="scale(0.5) translate(40, 8)"
                />
              </svg>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="relative"
            >
              <span className="text-xl md:text-2xl font-black tracking-tight">
                <span className="bg-gradient-to-r from-purple-400 via-pink-500 to-orange-400 bg-clip-text text-transparent">
                  סקינים
                </span>
                <span className="text-white/90 mr-1">ישראל</span>
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
