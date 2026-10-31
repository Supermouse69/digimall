import z from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { guardRateLimit } from "@/modules/bot-protection/server/guard";
import { RATE_LIMITS } from "@/modules/bot-protection/server/rate-limit";
import { chatActorFor } from "@/modules/chat/server/chat-service";

import { DELIVERY_MODES, isOrderCode } from "../state";
import {
  actOnStoreOrder,
  buyerOrderDetail,
  buyerOrders,
  cancelWholeOrder,
  MAX_ITEMS_PER_STORE,
  MAX_QTY,
  placeOrder,
  previewCheckout,
  storeAttentionCount,
  storeBoard,
  storeOrderView,
} from "./order-service";

const id = z.string().min(1).max(100);
const code = z.string().trim().max(12).refine((value) => isOrderCode(value.toUpperCase()), "Invalid order code.");

const cartInput = z.object({
  stores: z
    .array(
      z.object({
        storeSlug: z.string().min(1).max(100),
        items: z.array(z.object({ productId: id, qty: z.number().int().min(1).max(MAX_QTY) })).min(1).max(MAX_ITEMS_PER_STORE),
        note: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(10),
  mode: z.enum(DELIVERY_MODES),
  delivery: z
    .object({
      barangay: z.string().max(60).optional(),
      addressDetails: z.string().max(200).optional(),
      location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
    })
    .optional(),
});

// Logged-in buyers (their own orders) and sellers (their store's orders). The user always comes
// from the login cookie; order-service checks membership for every order.
const orderProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const actor = chatActorFor(ctx.user);
  if (!actor) throw new TRPCError({ code: "FORBIDDEN", message: "Orders are for buyers and stores." });
  return next({ ctx: { ...ctx, actor, svc: { payload: ctx.db } } });
});

export const ordersRouter = createTRPCRouter({
  preview: orderProcedure.input(cartInput).query(({ ctx, input }) => previewCheckout(ctx.svc, ctx.actor, input)),

  place: orderProcedure
    .input(cartInput.extend({ riderNotes: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      await guardRateLimit(ctx.db, RATE_LIMITS.checkout, `user:${ctx.user.id}`);
      return placeOrder(ctx.svc, ctx.actor, input);
    }),

  mine: orderProcedure.query(({ ctx }) => buyerOrders(ctx.svc, ctx.actor)),

  detail: orderProcedure.input(z.object({ code })).query(({ ctx, input }) => buyerOrderDetail(ctx.svc, ctx.actor, input.code.toUpperCase())),

  // One store order (order cards in chat, seller detail)
  storeOrder: orderProcedure.input(z.object({ storeOrderId: id })).query(({ ctx, input }) => storeOrderView(ctx.svc, ctx.actor, input.storeOrderId)),

  board: orderProcedure
    .input(z.object({ filter: z.enum(["active", "done"]).default("active") }))
    .query(({ ctx, input }) => storeBoard(ctx.svc, ctx.actor, input.filter)),

  attentionCount: orderProcedure.query(async ({ ctx }) => ({ count: await storeAttentionCount(ctx.svc, ctx.actor) })),

  act: orderProcedure
    .input(
      z.object({
        storeOrderId: id,
        action: z.enum(["store_confirm", "store_cancel", "buyer_cancel", "submit_payment", "payment_received", "payment_not_received"]),
        reason: z.string().max(300).optional(),
        receiptId: id.optional(),
        referenceNo: z.string().max(40).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await guardRateLimit(ctx.db, RATE_LIMITS.orderAction, `user:${ctx.user.id}`);
      const { storeOrderId, action, ...rest } = input;
      return actOnStoreOrder(ctx.svc, ctx.actor, storeOrderId, action, rest);
    }),

  cancelOrder: orderProcedure
    .input(z.object({ code, reason: z.string().max(300).optional() }))
    .mutation(async ({ ctx, input }) => {
      await guardRateLimit(ctx.db, RATE_LIMITS.orderAction, `user:${ctx.user.id}`);
      return cancelWholeOrder(ctx.svc, ctx.actor, input.code.toUpperCase(), input.reason);
    }),
});
