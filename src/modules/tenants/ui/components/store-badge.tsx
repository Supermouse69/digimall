import { BadgeCheckIcon, InfoIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// The badge says exactly what the admin checked, nothing more (CLAUDE.md §9 beta decision)
export const StoreBadge = ({ status, className }: { status: "unverified" | "verified"; className?: string }) =>
  status === "verified" ? (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border border-green-700 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800", className)}
      title="DigiMall checked this store's Mayor's/business permit or barangay business clearance."
    >
      <BadgeCheckIcon className="size-3.5" /> Business permit checked
    </span>
  ) : (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border border-amber-600 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800", className)}
      title="DigiMall hasn't checked this store's business papers yet."
    >
      <InfoIcon className="size-3.5" /> Unverified store
    </span>
  );
