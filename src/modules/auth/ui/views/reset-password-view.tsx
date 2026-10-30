"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import z from "zod";

import { useTRPC } from "@/trpc/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import { resetPasswordSchema } from "../../schemas";
import { AuthCard } from "../components/auth-card";

export const ResetPasswordView = ({ token }: { token: string }) => {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const reset = useMutation(trpc.auth.resetPassword.mutationOptions({
    onError: (error) => toast.error(error.message),
    onSuccess: async ({ redirectTo }) => {
      await queryClient.invalidateQueries(trpc.auth.session.queryFilter());
      toast.success("Password changed");
      if (redirectTo.startsWith("/admin")) {
        window.location.assign(redirectTo);
      } else {
        router.push(redirectTo);
        router.refresh();
      }
    },
  }));
  const form = useForm<z.infer<typeof resetPasswordSchema>>({
    mode: "onTouched",
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: "", confirmPassword: "" },
  });

  return (
    <AuthCard title="Choose a new password">
      <Form {...form}>
        <form onSubmit={form.handleSubmit((values) => reset.mutate(values))} className="flex flex-col gap-4">
          <FormField
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">New password</FormLabel>
                <FormControl>
                  <Input {...field} type="password" autoComplete="new-password" />
                </FormControl>
                <FormDescription>At least 10 characters.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Type it again</FormLabel>
                <FormControl>
                  <Input {...field} type="password" autoComplete="new-password" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" size="lg" disabled={reset.isPending} className="bg-black text-white">
            {reset.isPending ? "Saving..." : "Save new password"}
          </Button>
        </form>
      </Form>
      <Link href="/forgot-password" className="underline text-sm w-fit">Need a new link?</Link>
    </AuthCard>
  );
};
