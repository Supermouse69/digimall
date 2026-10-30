"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import z from "zod";

import { useTRPC } from "@/trpc/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

import { emailOnlySchema } from "../../schemas";
import { AuthCard } from "../components/auth-card";

export const ForgotPasswordView = () => {
  const trpc = useTRPC();
  const [sent, setSent] = useState(false);
  const forgot = useMutation(trpc.auth.forgotPassword.mutationOptions({
    onSuccess: () => setSent(true),
    onError: () => toast.error("Something went wrong. Please try again."),
  }));
  const form = useForm<z.infer<typeof emailOnlySchema>>({
    resolver: zodResolver(emailOnlySchema),
    defaultValues: { email: "" },
  });

  if (sent) {
    return (
      <AuthCard title="Check your email">
        <p>If that email has a DigiMall account, we sent a link to reset your password. It works for 1 hour.</p>
        <p className="text-sm text-neutral-600">Can&apos;t find it? Check your Spam or Promotions folder.</p>
        <Link href="/login" className="underline font-medium w-fit">Back to log in</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Forgot your password?">
      <p>Enter your email and we&apos;ll send you a link to choose a new password.</p>
      <Form {...form}>
        <form onSubmit={form.handleSubmit((values) => forgot.mutate(values))} className="flex flex-col gap-4">
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
          <Button type="submit" size="lg" disabled={forgot.isPending} className="bg-black text-white">
            {forgot.isPending ? "Sending..." : "Send reset link"}
          </Button>
        </form>
      </Form>
      <Link href="/login" className="underline text-sm w-fit">Back to log in</Link>
    </AuthCard>
  );
};
