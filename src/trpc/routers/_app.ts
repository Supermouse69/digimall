import {  createTRPCRouter } from '../init';
import { categoriesRouter } from '@/modules/categories/server/procedure';
import { authRouter } from '@/modules/auth/server/procedures';
import { productsRouter } from '@/modules/products/server/procedure';
import { tenantsRouter } from '@/modules/tenants/server/procedure';
import { legalRouter } from '@/modules/legal/server/procedures';
import { settingsRouter } from '@/modules/settings/server/procedures';
import { ridersRouter } from '@/modules/riders/server/procedures';
import { adminEntryRouter } from '@/modules/admin-security/server/procedures';
import { reportsRouter } from '@/modules/reports/server/procedures';
import { chatRouter } from '@/modules/chat/server/procedures';
import { ordersRouter } from '@/modules/orders/server/procedures';
 
export const appRouter = createTRPCRouter({
  auth: authRouter,
  tenants: tenantsRouter,
  products: productsRouter,
  categories: categoriesRouter,
  legal: legalRouter,
  settings: settingsRouter,
  riders: ridersRouter,
  adminEntry: adminEntryRouter,
  reports: reportsRouter,
  chat: chatRouter,
  orders: ordersRouter,

});
 
// export type definition of API
export type AppRouter = typeof appRouter;