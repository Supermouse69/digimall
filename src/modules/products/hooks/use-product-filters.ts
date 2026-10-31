import { useQueryStates, parseAsString, parseAsStringLiteral } from "nuqs";

import { sortValues } from "../sort";

// Same filters as search-params.ts (that one is for the server)
const params = {
  search: parseAsString.withOptions({ clearOnDefault: true }).withDefault(""),
  sort: parseAsStringLiteral(sortValues).withDefault("newest"),
  minPrice: parseAsString.withOptions({ clearOnDefault: true }).withDefault(""),
  maxPrice: parseAsString.withOptions({ clearOnDefault: true }).withDefault(""),
};

export const useProductFilters = () => {
  return useQueryStates(params);
};
