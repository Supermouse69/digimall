import { create } from "zustand";

// Opens the floating chat (chat head) from anywhere, e.g. "Chat with store" on a product page
export type ChatTarget = { storeSlug: string; productId?: string } | null;

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
