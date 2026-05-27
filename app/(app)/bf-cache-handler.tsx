"use client";

import { useEffect } from "react";

export function BFCacheHandler() {
  useEffect(() => {
    console.log("🛡️ BFCacheHandler mounted (Root Level)");

    const handlePageShow = (event: PageTransitionEvent) => {
      console.log("📄 [pageshow] persisted:", event.persisted);
      if (event.persisted) {
        console.log("🔄 BFCache restored → Forcing reload");
        window.location.reload();
      }
    };

    const handlePopState = () => {
      console.log("🔙 [popstate] Back/Forward button detected");
      setTimeout(() => window.location.reload(), 80);
    };

    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  return null;
}