"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useProductFilters } from "../../hooks/use-product-filters";
import { SORT_LABELS, sortValues } from "../../sort";

export const ProductSort = () => {
  const [filters, setFilters] = useProductFilters();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {sortValues.map((value) => (
        <Button
          key={value}
          size="sm"
          variant="secondary"
          className={cn(
            "rounded-full bg-white hover:bg-white",
            filters.sort !== value && "bg-transparent border-transparent hover:border-border hover:bg-transparent",
          )}
          onClick={() => setFilters({ sort: value })}
        >
          {SORT_LABELS[value]}
        </Button>
      ))}
    </div>
  );
};
