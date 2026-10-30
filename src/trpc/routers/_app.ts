import {  createTRPCRouter } from '../init';
import { categoriesRouter } from '@/modules/categories/server/procedure';
import { authRouter } from '@/modules/auth/server/procedures';
import { productsRouter } from '@/modules/products/server/procedure';
import { tagsRouter } from '@/modules/tags/server/procedure';
import { tenantsRouter } from '@/modules/tenants/server/procedure';
import { legalRouter } from '@/modules/legal/server/procedures';
import { settingsRouter } from '@/modules/settings/server/procedures';
import { ridersRouter } from '@/modules/riders/server/procedures';
import { adminEntryRouter } from '@/modules/admin-security/server/procedures';
 
export const appRouter = createTRPCRouter({
  auth: authRouter,
  tags:tagsRouter,
  tenants: tenantsRouter,
  products: productsRouter,
  categories: categoriesRouter,
  legal: legalRouter,
  settings: settingsRouter,
  riders: ridersRouter,
  adminEntry: adminEntryRouter,

});
 
// export type definition of API
export type AppRouter = typeof appRouter;