import { z } from "zod";

// Emails are trimmed and lowercased before anything else, so " Ana@X.com"
// and "ana@x.com" are the same account everywhere.
const email = z.string().trim().toLowerCase().max(254);

export const signupBody = z.strictObject({
  email: email.pipe(z.email()),
  // Length matters more than symbol rules (NIST SP 800-63B). Never trim passwords.
  // The max stops someone from sending a 10 MB "password" to hash.
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100),
});

// Login only checks the shape: telling someone "that's not a valid email"
// is fine, but it shouldn't hint at whether an account exists.
export const loginBody = z.strictObject({
  email,
  password: z.string().min(1).max(128),
});

export const refreshTokenBody = z.strictObject({
  refreshToken: z.string().min(1).max(200),
});

export type SignupInput = z.output<typeof signupBody>;
export type LoginInput = z.output<typeof loginBody>;
