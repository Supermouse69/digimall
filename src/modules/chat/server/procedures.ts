import z from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { guardRateLimit } from "@/modules/bot-protection/server/guard";
import { RATE_LIMITS } from "@/modules/bot-protection/server/rate-limit";

import {
  chatActorFor,
  findStoreThread,
  getThread,
  listThreads,
  markRead,
  sendMessage,
  unreadCount,
} from "./chat-service";

const id = z.string().min(1).max(100);

// Logged-in buyers (as themselves) and sellers (as their store). The user always comes from the
// login cookie; membership is checked in chat-service for every chat.
const chatProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const actor = chatActorFor(ctx.user);
  if (!actor) throw new TRPCError({ code: "FORBIDDEN", message: "Chat is for buyers and stores." });
  return next({ ctx: { ...ctx, actor, chat: { payload: ctx.db } } });
});

export const chatRouter = createTRPCRouter({
  // Who am I in chat (the chat head uses this to decide whether to show itself)
  me: protectedProcedure.query(({ ctx }) => ({ side: chatActorFor(ctx.user)?.side ?? null })),

  threads: chatProcedure.query(({ ctx }) => listThreads(ctx.chat, ctx.actor)),

  unreadCount: chatProcedure.query(async ({ ctx }) => ({ count: await unreadCount(ctx.chat, ctx.actor) })),

  thread: chatProcedure
    .input(z.object({ conversationId: id, after: z.string().datetime().optional() }))
    .query(({ ctx, input }) => getThread(ctx.chat, ctx.actor, input.conversationId, input.after)),

  findStoreThread: chatProcedure
    .input(z.object({ storeSlug: z.string().min(1).max(100) }))
    .query(({ ctx, input }) => findStoreThread(ctx.chat, ctx.actor, input.storeSlug)),

  send: chatProcedure
    .input(
      z
        .object({
          conversationId: id.optional(),
          storeSlug: z.string().min(1).max(100).optional(),
          text: z.string().max(2000).optional(),
          imageId: id.optional(),
          productId: id.optional(),
        })
        .refine((value) => value.conversationId || value.storeSlug, { message: "Pick a chat first." }),
    )
    .mutation(async ({ ctx, input }) => {
      await guardRateLimit(ctx.db, RATE_LIMITS.chatSend, `user:${ctx.user.id}`);
      return sendMessage(ctx.chat, ctx.actor, input);
    }),

  markRead: chatProcedure
    .input(z.object({ conversationId: id }))
    .mutation(async ({ ctx, input }) => {
      await markRead(ctx.chat, ctx.actor, input.conversationId);
      return { success: true as const };
    }),
});
