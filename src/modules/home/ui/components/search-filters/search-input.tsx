"use client";

import { useEffect, useState } from "react";
import { ListFilterIcon, SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useProductFilters } from "@/modules/products/hooks/use-product-filters";

import { CategoriesSidebar } from "./categories-sidebar";

interface Props {
  disabled?: boolean;
};

// Searches product names. Waits until the buyer stops typing, so slow phones and mobile data
// don't send a request on every key.
export const SearchInput = ({
  disabled,
}: Props) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [filters, setFilters] = useProductFilters();
  const [text, setText] = useState(filters.search);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (text.trim() !== filters.search) setFilters({ search: text.trim().slice(0, 100) });
    }, 400);
    return () => clearTimeout(timer);
  }, [text, filters.search, setFilters]);

  return (
    <div className="flex items-center gap-2 w-full">
      <CategoriesSidebar open={isSidebarOpen} onOpenChange={setIsSidebarOpen} />
      <form
        role="search"
        className="relative w-full"
        onSubmit={(event) => {
          event.preventDefault();
          setFilters({ search: text.trim().slice(0, 100) });
        }}
      >
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-neutral-500" />
        <Input
          className="pl-8"
          placeholder="Search products"
          disabled={disabled}
          value={text}
          maxLength={100}
          onChange={(event) => setText(event.target.value)}
          aria-label="Search products"
        />
      </form>
      <Button
        variant="elevated"
        className="size-12 shrink-0 flex lg:hidden"
        onClick={() => setIsSidebarOpen(true)}
      >
        <ListFilterIcon />
      </Button>
    </div>
  );
};
