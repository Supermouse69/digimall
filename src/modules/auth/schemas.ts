import z from "zod";

// The page to return to after login (checked again on the server with safeRedirectPath)
const nextPath = z.string().max(300).optional();

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1, "Enter your password").max(128),
  next: nextPath,
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(100),
  email: z.email().max(254),
  password: z.string().min(10, "Password must be at least 10 characters").max(128),
  next: nextPath,
});
