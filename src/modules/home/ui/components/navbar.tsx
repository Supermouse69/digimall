"use client";

import Link from "next/link";
import { useState } from "react";
import { MenuIcon } from "lucide-react";
import { Poppins } from "next/font/google";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { cn } from "@/lib/utils";
import { useLogout } from "@/modules/auth/hooks/use-logout";

import { Button } from "@/components/ui/button";

import { NavbarSidebar } from "./navbar-sidebar";
import { getAccountLinks } from "./account-links";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["700"],
});

interface NavbarItemProps {
  href: string;
  children: React.ReactNode;
  isActive?: boolean;
};

const NavbarItem = ({
  href,
  children,
  isActive,
}: NavbarItemProps) => {
  return (
    <Button
      asChild
      variant="outline"
      className={cn(
        "bg-transparent hover:bg-transparent rounded-full hover:border-primary border-transparent px-3.5 text-lg",
        isActive && "bg-black text-white hover:bg-black hover:text-white",
      )}
    >
      <Link href={href}>
        {children}
      </Link>
    </Button>
  );
};

const navbarItems = [
  { href: "/", children: "Home" },
  { href: "/about", children: "About" },
  { href: "/features", children: "Features" },
  { href: "/pricing", children: "Pricing" },
  { href: "/contact", children: "Contact" },
];

const accountButtonClass =
  "border-l border-t-0 border-b-0 border-r-0 px-8 h-full rounded-none transition-colors text-lg";

export const Navbar = () => {
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const trpc = useTRPC();
  const session = useQuery(trpc.auth.session.queryOptions());
  const user = session.data?.user ?? null;
  const accountLinks = getAccountLinks(user);
  const logout = useLogout();

  return (
    <nav className="h-20 flex border-b justify-between font-medium bg-white">
      <Link href="/" className="pl-6 flex items-center">
        <span className={cn("text-5xl font-semibold", poppins.className)}>
          DigiMall
        </span>
      </Link>

      <NavbarSidebar
        items={navbarItems}
        user={user}
        open={isSidebarOpen}
        onOpenChange={setIsSidebarOpen}
      />

      <div className="items-center gap-4 hidden lg:flex">
        {navbarItems.map((item) => (
          <NavbarItem
            key={item.href}
            href={item.href}
            isActive={pathname === item.href}
          >
            {item.children}
          </NavbarItem>
        ))}
      </div>

      <div className="hidden lg:flex">
        {accountLinks.map((link, index) => (
          <Button
            key={link.href}
            asChild
            variant="secondary"
            className={cn(
              accountButtonClass,
              // First link is the main action: dark button
              index === 0
                ? "bg-black text-white hover:bg-pink-400 hover:text-black"
                : "bg-white hover:bg-pink-400",
            )}
          >
            <Link prefetch href={link.href}>
              {link.label}
            </Link>
          </Button>
        ))}
        {user && (
          <Button
            variant="secondary"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
            className={cn(accountButtonClass, "bg-white hover:bg-pink-400")}
          >
            {logout.isPending ? "Logging out..." : "Log out"}
          </Button>
        )}
      </div>

      <div className="flex lg:hidden items-center justify-center">
        <Button
          variant="ghost"
          className="size-12 border-transparent bg-white"
          onClick={() => setIsSidebarOpen(true)}
          aria-label="Open menu"
        >
          <MenuIcon />
        </Button>
      </div>
    </nav>
  );
};
