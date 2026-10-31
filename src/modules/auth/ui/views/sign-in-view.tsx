"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Poppins } from "next/font/google";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import z from "zod";

import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { TurnstileWidget, useTurnstile } from "@/modules/bot-protection/ui/turnstile-widget";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import { loginSchema } from "../../schemas";
import { CheckEmailNotice } from "../components/check-email-notice";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["700"],
});

interface Props {
  next?: string;
  // Friendly note after an email link: "verified" or "reset"
  notice?: "verified" | "reset";
}

const NOTICES = {
  verified: "Your email is confirmed. You can log in now.",
  reset: "Your password was changed. Please log in.",
} as const;

export const SignInView = ({ next, notice }: Props) => {
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const trpc = useTRPC();
  const turnstile = useTurnstile();
  const login = useMutation(trpc.auth.login.mutationOptions({
    onSettled: () => turnstile.reset(),
    onError: (error, variables) => {
      if (error.data?.code === "FORBIDDEN") {
        setUnverifiedEmail(variables.email);
        return;
      }
      toast.error(error.message);
    },
    onSuccess: async ({ redirectTo }) => {
      await queryClient.invalidateQueries(trpc.auth.session.queryFilter());
      // The Payload admin panel is outside this app's router, so do a full page load for it
      if (redirectTo.startsWith("/admin")) {
        window.location.assign(redirectTo);
      } else {
        router.push(redirectTo);
        router.refresh();
      }
    },
  }));

  const form = useForm<z.infer<typeof loginSchema>>({
    mode: "onTouched",
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      next,
    },
  });

  const onSubmit = (values: z.infer<typeof loginSchema>) => {
    login.mutate({ ...values, next, turnstileToken: turnstile.token });
  };

  const signUpHref = next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5">
      <div className="bg-[#F4F4F0] min-h-screen w-full lg:col-span-3 overflow-y-auto">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-8 p-4 lg:p-16"
          >
            <div className="flex items-center justify-between mb-8">
              <Link href="/">
                <span className={cn("text-2xl font-semibold", poppins.className)}>
                  DigiMall
                </span>
              </Link>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="text-base border-none underline"
              >
                <Link prefetch href={signUpHref}>
                  Sign up
                </Link>
              </Button>
            </div>
            <h1 className="text-4xl font-medium">
              Log in to DigiMall
            </h1>
            {notice && !unverifiedEmail && (
              <p className="rounded-md border border-green-600 bg-green-50 p-3">{NOTICES[notice]}</p>
            )}
            {unverifiedEmail && <CheckEmailNotice email={unverifiedEmail} />}
            <FormField
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Email</FormLabel>
                  <FormControl>
                    <Input {...field} type="email" autoComplete="email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Password</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" autoComplete="current-password" />
                  </FormControl>
                  <FormMessage />
                  <Link href="/forgot-password" className="text-sm underline w-fit">
                    Forgot password?
                  </Link>
                </FormItem>
              )}
            />
            <TurnstileWidget {...turnstile.widgetProps} />
            <Button
              disabled={login.isPending || !turnstile.token}
              type="submit"
              size="lg"
              variant="elevated"
              className="bg-black text-white hover:bg-pink-400 hover:text-primary"
            >
              {login.isPending ? "Logging in..." : "Log in"}
            </Button>
          </form>
        </Form>
      </div>
      <div
        className="h-screen w-full lg:col-span-2 hidden lg:block"
        style={{
          backgroundImage: "url('/placeholder.svg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
    </div>
  );
};
