// Product sort options. Honest ones only: no fake "trending" or "hot" labels (CLAUDE.md §9 consumer protection).
export const sortValues = ["newest", "price_low", "price_high"] as const;
export type SortValue = (typeof sortValues)[number];

export const SORT_LABELS: Record<SortValue, string> = {
  newest: "Newest",
  price_low: "Price: low to high",
  price_high: "Price: high to low",
};
