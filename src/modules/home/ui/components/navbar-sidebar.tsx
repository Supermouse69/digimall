import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import Link from "next/link";

import { useLogout } from "@/modules/auth/hooks/use-logout";
import type { SessionUser } from "@/modules/auth/server/procedures";

import { getAccountLinks } from "./account-links";

interface NavbarItem {
  href: string;
  children: React.ReactNode;
}

interface Props {
  items: NavbarItem[];
  user: SessionUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const itemClass =
  "w-full text-left p-4 hover:bg-black hover:text-white flex items-center text-base font-medium";

export const NavbarSidebar = ({ items, user, open, onOpenChange }: Props) => {
  const logout = useLogout();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className={"p-0 transition-none"}>
        <SheetHeader className="p-4 border-b">
          <SheetTitle>{user ? `Hi, ${user.name.split(" ")[0]}` : "Menu"}</SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex flex-col overflow-y-auto h-full pb-2">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={itemClass}
              onClick={() => onOpenChange(false)}
            >
              {item.children}
            </Link>
          ))}

          <div className="border-t">
            {getAccountLinks(user).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={itemClass}
                onClick={() => onOpenChange(false)}
              >
                {link.label}
              </Link>
            ))}
            {user && (
              <button
                type="button"
                className={itemClass}
                disabled={logout.isPending}
                onClick={() => {
                  onOpenChange(false);
                  logout.mutate();
                }}
              >
                {logout.isPending ? "Logging out..." : "Log out"}
              </button>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
