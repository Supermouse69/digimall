"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Poppins } from "next/font/google";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import z from "zod";

import { cn } from "@/lib/utils";
import type { LatLng } from "@/lib/geo";
import { useTRPC } from "@/trpc/client";
import { TurnstileWidget, useTurnstile } from "@/modules/bot-protection/ui/turnstile-widget";
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

import { registerSchema } from "../../schemas";
import { CheckEmailNotice } from "../components/check-email-notice";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["700"],
});

// Leaflet needs the browser (window), so the map loads only on the client
const LocationPicker = dynamic(() => import("@/components/map/location-picker"), {
  ssr: false,
  loading: () => <div className="h-72 w-full rounded-md border bg-neutral-100 animate-pulse" />,
});

export interface SignupOptions {
  barangays: string[];
  serviceCenter: LatLng;
  serviceRadiusKm: number;
  minimumAge: number;
  keyPoints: string[];
  documents: { slug: string; title: string; version: number }[];
}

interface Props {
  next?: string;
  options: SignupOptions;
}

type FormValues = z.input<typeof registerSchema>;

const legalLink = (slug: string, label: string) => (
  <Link href={`/legal/${slug}`} target="_blank" rel="noopener" className="underline font-medium">
    {label}
  </Link>
);

export const SignUpView = ({ next, options }: Props) => {
  const trpc = useTRPC();
  // After sign-up we show "check your email" instead of logging in (email must be confirmed first)
  const [sentTo, setSentTo] = useState<string | null>(null);
  const turnstile = useTurnstile();
  const register = useMutation(trpc.auth.register.mutationOptions({
    onSettled: () => turnstile.reset(),
    onError: (error) => {
      toast.error(error.message);
    },
    onSuccess: (_result, variables) => {
      setSentTo(variables.email);
      window.scrollTo({ top: 0 });
    },
  }));

  const form = useForm<FormValues>({
    mode: "onTouched",
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      password: "",
      barangay: "",
      addressDetails: "",
      location: undefined,
      acceptTerms: false,
      acceptPrivacy: false,
      confirmAge: false,
      next,
    },
  });

  const onSubmit = (values: FormValues) => {
    register.mutate({ ...(values as z.output<typeof registerSchema>), next, turnstileToken: turnstile.token });
  };

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";
  const termsTitle = options.documents.find((doc) => doc.slug === "terms-buyer")?.title ?? "Terms of Service";
  const privacyTitle = options.documents.find((doc) => doc.slug === "privacy")?.title ?? "Privacy Notice";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5">
      <div className="bg-[#F4F4F0] min-h-screen w-full lg:col-span-3 overflow-y-auto">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-6 p-4 lg:p-16"
            noValidate
          >
            <div className="flex items-center justify-between mb-4">
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
                <Link prefetch href={loginHref}>
                  Log in
                </Link>
              </Button>
            </div>
            <h1 className="text-3xl lg:text-4xl font-medium">
              {sentTo ? "Almost done!" : "Create your buyer account"}
            </h1>

            {sentTo ? (
              <CheckEmailNotice email={sentTo} />
            ) : (
            <>

            <FormField
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Full name</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Mobile number</FormLabel>
                  <FormControl>
                    <Input {...field} type="tel" inputMode="tel" autoComplete="tel" placeholder="09XXXXXXXXX" />
                  </FormControl>
                  <FormDescription>Stores and riders never see it outside an active delivery.</FormDescription>
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
                    <Input {...field} type="password" autoComplete="new-password" />
                  </FormControl>
                  <FormDescription>At least 10 characters.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <h2 className="text-xl font-medium pt-2">Where should we deliver?</h2>
            <FormField
              name="barangay"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Barangay</FormLabel>
                  <FormControl>
                    <select
                      {...field}
                      className="h-12 w-full rounded-md border border-input bg-white px-3 text-base"
                    >
                      <option value="" disabled>Choose your barangay</option>
                      {options.barangays.map((barangay) => (
                        <option key={barangay} value={barangay}>{barangay}</option>
                      ))}
                    </select>
                  </FormControl>
                  <FormDescription>We only deliver to these barangays for now.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              name="addressDetails"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Street / purok / house details</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="street-address" placeholder="e.g. Purok 3, blue gate near the chapel" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Map pin</FormLabel>
                  <LocationPicker
                    center={options.serviceCenter}
                    radiusKm={options.serviceRadiusKm}
                    value={(field.value as LatLng | undefined) ?? null}
                    onChange={(point) => {
                      field.onChange(point);
                      field.onBlur();
                    }}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            {options.keyPoints.length > 0 && (
              <div className="rounded-md border bg-white p-4 flex flex-col gap-2">
                <p className="font-medium">Before you join</p>
                <ul className="list-disc pl-5 text-sm flex flex-col gap-1">
                  {options.keyPoints.map((point, index) => (
                    <li key={index}>{point}</li>
                  ))}
                </ul>
                <p className="text-sm text-neutral-600">Full details are in the {legalLink("terms-buyer", termsTitle)}.</p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <FormField
                name="acceptTerms"
                render={({ field }) => (
                  <FormItem>
                    <label className="flex items-start gap-3 text-base cursor-pointer">
                      <FormControl>
                        <input
                          type="checkbox"
                          className="mt-1 size-5 shrink-0 accent-black"
                          checked={Boolean(field.value)}
                          onChange={(event) => field.onChange(event.target.checked)}
                          onBlur={field.onBlur}
                        />
                      </FormControl>
                      <span>I agree to the {legalLink("terms-buyer", termsTitle)}.</span>
                    </label>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="acceptPrivacy"
                render={({ field }) => (
                  <FormItem>
                    <label className="flex items-start gap-3 text-base cursor-pointer">
                      <FormControl>
                        <input
                          type="checkbox"
                          className="mt-1 size-5 shrink-0 accent-black"
                          checked={Boolean(field.value)}
                          onChange={(event) => field.onChange(event.target.checked)}
                          onBlur={field.onBlur}
                        />
                      </FormControl>
                      <span>
                        I have read the {legalLink("privacy", privacyTitle)} and agree to how DigiMall uses my information.
                      </span>
                    </label>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="confirmAge"
                render={({ field }) => (
                  <FormItem>
                    <label className="flex items-start gap-3 text-base cursor-pointer">
                      <FormControl>
                        <input
                          type="checkbox"
                          className="mt-1 size-5 shrink-0 accent-black"
                          checked={Boolean(field.value)}
                          onChange={(event) => field.onChange(event.target.checked)}
                          onBlur={field.onBlur}
                        />
                      </FormControl>
                      <span>I am at least {options.minimumAge} years old.</span>
                    </label>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <TurnstileWidget {...turnstile.widgetProps} />
            <Button
              disabled={register.isPending || !turnstile.token}
              type="submit"
              size="lg"
              variant="elevated"
              className="bg-black text-white hover:bg-pink-400 hover:text-primary"
            >
              {register.isPending ? "Creating account..." : "Create account"}
            </Button>
            </>
            )}
          </form>
        </Form>
      </div>
      <div
        className="h-screen w-full lg:col-span-2 hidden lg:block sticky top-0"
        style={{
          backgroundImage: "url('/placeholder.svg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
    </div>
  );
};
