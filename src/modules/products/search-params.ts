import { parseAsString, createLoader, parseAsStringLiteral } from "nuqs/server";

import { sortValues } from "./sort";

export { sortValues };

const params = {
  search: parseAsString.withOptions({ clearOnDefault: true }).withDefault(""),
  sort: parseAsStringLiteral(sortValues).withDefault("newest"),
  minPrice: parseAsString.withOptions({ clearOnDefault: true }).withDefault(""),
  maxPrice: parseAsString.withOptions({ clearOnDefault: true }).withDefault(""),
};

export const loadProductFilters = createLoader(params);
