import z from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { guardRateLimit } from "@/modules/bot-protection/server/guard";
import { RATE_LIMITS } from "@/modules/bot-protection/server/rate-limit";
import { chatActorFor } from "@/modules/chat/server/chat-service";
import { isOrderCode } from "@/modules/orders/state";

import {
  buyerTrip,
  cancelRiderRequest,
  deliver,
  incomingRequest,
  listBookableRiders,
  pickUp,
  requestRider,
  respondToRequest,
  riderHistory,
  riderStatus,
  riderTrip,
  setActive,
  setRiderPhone,
  updateLocation,
} from "./trip-service";

const id = z.string().min(1).max(100);
const code = z.string().trim().max(12).refine((value) => isOrderCode(value.toUpperCase()), "Invalid order code.");
const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

// The user always comes from the login cookie; trip-service checks role, ownership and status
const tripProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const actor = chatActorFor(ctx.user);
  if (!actor) throw new TRPCError({ code: "FORBIDDEN", message: "Not available for this account." });
  return next({ ctx: { ...ctx, actor, svc: { payload: ctx.db } } });
});

export const tripsRouter = createTRPCRouter({
  // ---- rider portal ----
  status: tripProcedure.query(({ ctx }) => riderStatus(ctx.svc, ctx.actor)),
  setActive: tripProcedure
    .input(z.object({ active: z.boolean(), location: point.optional() }))
    .mutation(({ ctx, input }) => setActive(ctx.svc, ctx.actor, input.active, input.location)),
  updateLocation: tripProcedure.input(point).mutation(async ({ ctx, input }) => {
    await guardRateLimit(ctx.db, RATE_LIMITS.riderLocation, `user:${ctx.user.id}`);
    return updateLocation(ctx.svc, ctx.actor, input);
  }),
  setPhone: tripProcedure.input(z.object({ phone: z.string().max(20) })).mutation(({ ctx, input }) => setRiderPhone(ctx.svc, ctx.actor, input.phone)),
  incoming: tripProcedure.query(({ ctx }) => incomingRequest(ctx.svc, ctx.actor)),
  respond: tripProcedure
    .input(z.object({ orderId: id, accept: z.boolean() }))
    .mutation(({ ctx, input }) => respondToRequest(ctx.svc, ctx.actor, input.orderId, input.accept)),
  myTrip: tripProcedure.query(({ ctx }) => riderTrip(ctx.svc, ctx.actor)),
  pickUp: tripProcedure.input(z.object({ storeOrderId: id })).mutation(({ ctx, input }) => pickUp(ctx.svc, ctx.actor, input.storeOrderId)),
  deliver: tripProcedure
    .input(z.object({ orderId: id, feeCollected: z.number().int().min(0).max(10_000) }))
    .mutation(({ ctx, input }) => deliver(ctx.svc, ctx.actor, input.orderId, input.feeCollected)),
  history: tripProcedure.query(({ ctx }) => riderHistory(ctx.svc, ctx.actor)),

  // ---- buyer: book a rider ----
  riders: tripProcedure.input(z.object({ code })).query(({ ctx, input }) => listBookableRiders(ctx.svc, ctx.actor, input.code.toUpperCase())),
  request: tripProcedure
    .input(z.object({ code, riderId: id.optional(), auto: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      await guardRateLimit(ctx.db, RATE_LIMITS.riderRequest, `user:${ctx.user.id}`);
      return requestRider(ctx.svc, ctx.actor, input.code.toUpperCase(), { riderId: input.riderId, auto: input.auto });
    }),
  cancelRequest: tripProcedure.input(z.object({ code })).mutation(({ ctx, input }) => cancelRiderRequest(ctx.svc, ctx.actor, input.code.toUpperCase())),
  buyerTrip: tripProcedure.input(z.object({ code })).query(({ ctx, input }) => buyerTrip(ctx.svc, ctx.actor, input.code.toUpperCase())),
});
