import type { Metadata } from "next";
import  {DM_Sans} from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { TRPCReactProvider } from "@/trpc/client";
import { Toaster } from "@/components/ui/sonner";
import {NuqsAdapter} from "nuqs/adapters/next/app";
import { ChatHead } from "@/modules/chat/ui/chat-head";



const dm_Sans = DM_Sans({
  subsets:["latin"]
})



export const metadata: Metadata = {
  title: "DigiMall",
  description: "Shop from neighborhood stores in Calumpit, Bulacan, delivered by local tricycle riders.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("h-full", "antialiased",  "font-sans", dm_Sans.className)}
    >
       <body className="h-full">
        <NuqsAdapter> 
        <TRPCReactProvider>
          {children}
          <ChatHead />
          <Toaster/>
        </TRPCReactProvider>
        </NuqsAdapter>
      </body>
      
    </html>
  );
}
