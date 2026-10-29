//possible solution for the categories bug 6:38:06

"use client";

import { ListFilterIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { CategoryDropdown } from "./category-dropdown";
import { CategoriesSidebar } from "./categories-sidebar";
import { CategoriesGetManyOutput } from "@/modules/categories/types";
//import { CustomCategory } from "../types";

interface Props {
  data: CategoriesGetManyOutput;
}

export const Categories = ({ data }: Props) => {
  const pathname = usePathname();
  const params = useParams();

  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const viewAllRef = useRef<HTMLDivElement>(null);

  const [visibleCount, setVisibleCount] = useState(data.length);
  const [isAnyHovered, setIsAnyHovered] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const categoryParam = params.category as string | undefined;
  const activeCategory = categoryParam || "all";



  const activeCategoryIndex = data.findIndex((cat) => cat.slug === activeCategory);
  const isActiveCategoryHidden = activeCategoryIndex >= visibleCount && activeCategoryIndex !== -1;

  useEffect(() => {
    const calculateVisible = () => {
      if (!containerRef.current || !measureRef.current || !viewAllRef.current) return;

      const containerWidth = containerRef.current.offsetWidth;
      const viewAllWidth = viewAllRef.current.offsetWidth;
      const availableWidth = containerWidth - viewAllWidth;

      const items = Array.from(measureRef.current.children);
      let totalWidth = 0;
      let visible = 0;

      for (const item of items) {
        const width = item.getBoundingClientRect().width;

        if (totalWidth + width > availableWidth) break;
        totalWidth += width;
        visible++;
      }

      setVisibleCount(visible);
    };

    const resizeObserver = new ResizeObserver(calculateVisible);
    resizeObserver.observe(containerRef.current!);

    return () => resizeObserver.disconnect();
  }, [data.length]);

  return (
    <div className="relative w-full">
      {/* Categories sidebar */}
      <CategoriesSidebar open={isSidebarOpen} onOpenChange={setIsSidebarOpen} />

      {/* Hidden div to measure all items */}
      <div
        ref={measureRef}
        className="absolute opacity-0 pointer-events-none flex"
        style={{ position: "fixed", top: -9999, left: -9999 }}
      >
        {data.map((category) => (
          <div key={category.id}>
            <CategoryDropdown
              category={category}
              isActive={activeCategory === category.slug}
              isNavigationHovered={false}
            />
          </div>
        ))}
      </div>

      {/* Visible items */}
      <div 
        ref={containerRef}
        className="flex flex-nowrap items-center"
        onMouseEnter={() => setIsAnyHovered(true)}
        onMouseLeave={() => setIsAnyHovered(false)}
      >
        {data.slice(0, visibleCount).map((category) => (
          <div key={category.id}>
            <CategoryDropdown
              category={category}
              isActive={activeCategory === category.slug}
              isNavigationHovered={isAnyHovered}
            />
          </div>
        ))}

        <div ref={viewAllRef} className="shrink-0">
          <Button
            variant="elevated"
            className={cn(
              "h-11 px-4 bg-transparent border-transparent rounded-full hover:bg-white hover:border-primary text-black",
              isActiveCategoryHidden && !isAnyHovered && "bg-white border-primary",
            )}
            onClick={() => setIsSidebarOpen(true)}
          >
            View All
            <ListFilterIcon className="ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
};
/*
  const calculateVisible = useCallback(() => {
    if (!containerRef.current || !measureRef.current || !viewAllRef.current) return;

    const containerWidth = containerRef.current.offsetWidth;
    if (containerWidth <= 0) return;

    const viewAllWidth = viewAllRef.current.offsetWidth;
    const availableWidth = containerWidth - viewAllWidth;
    if (availableWidth <= 0) return;

    const items = Array.from(measureRef.current.children);
    if (!items.length) return;

    let totalWidth = 0;
    let visible = 0;

    for (const item of items) {
      const width = item.getBoundingClientRect().width;
      if (width <= 0) continue;

      if (totalWidth + width > availableWidth) break;

      totalWidth += width;
      visible++;
    }

    setVisibleCount((prev) => (prev === visible ? prev : visible));
  }, []);

  // Initial + route change recalculation
  useEffect(() => {
    const run = () => {
      requestAnimationFrame(() => {
        calculateVisible();
        // second pass ensures layout is fully stable
        requestAnimationFrame(calculateVisible);
      });
    };

    run();

    const observer = new ResizeObserver(run);

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [calculateVisible, pathname]);

  // ✅ FIX: browser back / forward cache restore
  useEffect(() => {
    const handlePageShow = () => {
      requestAnimationFrame(() => {
        calculateVisible();
        requestAnimationFrame(calculateVisible);
      });
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [calculateVisible]);

  const activeCategoryIndex = data.findIndex(
    (cat) => cat.slug === activeCategory
  );

  const isActiveCategoryHidden =
    activeCategoryIndex >= visibleCount && activeCategoryIndex !== -1;

  return (
    <div className="relative w-full">
      <CategoriesSidebar
        key={pathname}
        open={isSidebarOpen}
        onOpenChange={setIsSidebarOpen}
      />

       //Hidden measurement container 
      <div
        ref={measureRef}
        className="absolute opacity-0 pointer-events-none flex"
        style={{ position: "fixed", top: -9999, left: -9999 }}
      >
        {data.map((category) => (
          <div key={category.id}>
            <CategoryDropdown
              category={category}
              isActive={activeCategory === category.slug}
              isNavigationHovered={false}
            />
          </div>
        ))}
      </div>

      // Visible categories 
      <div
        ref={containerRef}
        className="flex flex-nowrap items-center"
        onMouseEnter={() => setIsAnyHovered(true)}
        onMouseLeave={() => setIsAnyHovered(false)}
      >
        {data.slice(0, visibleCount).map((category) => (
          <div key={category.id}>
            <CategoryDropdown
              category={category}
              isActive={activeCategory === category.slug}
              isNavigationHovered={isAnyHovered}
            />
          </div>
        ))}

        <div ref={viewAllRef} className="shrink-0">
          <Button
            className={cn(
              "h-11 px-4 bg-transparent border-transparent rounded-full hover:bg-white hover:border-primary text-black",
              isActiveCategoryHidden &&
                !isAnyHovered &&
                "bg-white border-primary"
            )}
            onClick={() => setIsSidebarOpen(true)}
          >
            View All
            <ListFilterIcon className="ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
};

*/