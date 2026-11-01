import { create } from "zustand";

// Opens the floating chat (chat head) from anywhere, e.g. "Chat with store" on a product page
// A store (from a store/product page) or a specific chat, e.g. the trip chat with the rider
export type ChatTarget = { storeSlug: string; productId?: string } | { conversationId: string } | null;

interface ChatWidgetState {
  isOpen: boolean;
  target: ChatTarget;
  open: (target?: ChatTarget) => void;
  close: () => void;
}

export const useChatWidget = create<ChatWidgetState>()((set) => ({
  isOpen: false,
  target: null,
  open: (target = null) => set({ isOpen: true, target }),
  close: () => set({ isOpen: false, target: null }),
}));
