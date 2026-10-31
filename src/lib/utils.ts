import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Public store page (CLAUDE.md §5: /store/[slug]; the old /tenants/... links redirect here)
export function generateTenantURL(tenantSlug: string){
  return `/store/${encodeURIComponent(tenantSlug)}`;
};

// Philippine peso, whole pesos (CLAUDE.md §12): ₱1,234
export function formatCurrency(value: number | string){
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value))
}