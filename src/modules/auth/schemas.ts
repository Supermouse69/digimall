import z from "zod";

import { isPhMobile, PH_MOBILE_HINT } from "@/lib/ph-phone";

// Used by both the browser form and the server. The server re-checks everything
// (and also checks the barangay list + delivery area from Settings).

// The page to return to after login (checked again on the server with safeRedirectPath)
const nextPath = z.string().max(300).optional();

const mustAccept = (message: string) =>
  z.boolean().refine((value) => value === true, { message });

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1, "Enter your password").max(128),
  next: nextPath,
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(100),
  email: z.email().max(254),
  phone: z.string().trim().refine(isPhMobile, PH_MOBILE_HINT),
  password: z.string().min(10, "Password must be at least 10 characters").max(128),
  barangay: z.string().trim().min(1, "Pick your barangay").max(60),
  addressDetails: z.string().trim().min(3, "Add your street, purok, or house details").max(200),
  location: z.object(
    {
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    },
    { error: "Drop a pin on the map where we should deliver" },
  ),
  acceptTerms: mustAccept("You need to agree to the Terms of Service"),
  acceptPrivacy: mustAccept("You need to agree to the Privacy Notice"),
  confirmAge: mustAccept("Please confirm your age"),
  next: nextPath,
});

export const acceptConsentsSchema = z.object({
  accept: mustAccept("Please tick the box to continue"),
});

export const emailOnlySchema = z.object({
  email: z.email().max(254),
});

// Tokens from email links: Payload makes 40 hex characters; allow a little room, nothing else
const emailToken = z.string().min(20).max(128).regex(/^[a-zA-Z0-9]+$/, "This link is invalid.");

export const verifyEmailSchema = z.object({
  token: emailToken,
});

export const resetPasswordSchema = z
  .object({
    token: emailToken,
    password: z.string().min(10, "Password must be at least 10 characters").max(128),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });
