// Shared by the Reports collection (server) and the report dialog (browser): no server imports here.
export const REPORT_TARGETS = ["product", "store"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_REASONS = [
  { value: "prohibited", label: "Prohibited item (medicine, alcohol, vape, weapons...)" },
  { value: "scam", label: "Scam or fake store" },
  { value: "wrong_info", label: "Wrong price or wrong information" },
  { value: "offensive", label: "Offensive content" },
  { value: "other", label: "Something else" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["value"];
