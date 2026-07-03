import {  createTRPCRouter } from '../init';
import { categoriesRouter } from '@/modules/categories/server/procedure';
import { authRouter } from '@/modules/auth/server/procedures';
import { productsRouter } from '../../modules/products/server/procedure';
import { tagsRouter } from '@/modules/tags/server/procedure';
import { tenantsRouter } from '@/modules/tenants/server/procedure';
 
export const appRouter = createTRPCRouter({
  auth: authRouter,
  tags:tagsRouter,
  tenants: tenantsRouter,
  products: productsRouter,
  categories: categoriesRouter

});
 
// export type definition of API
export type AppRouter = typeof appRouter;