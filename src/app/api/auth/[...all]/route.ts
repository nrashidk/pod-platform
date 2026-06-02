// Better Auth HTTP surface. This catch-all mounts every Better Auth endpoint
// (sign-in, sign-out, get-session, etc.) under /api/auth/*. It is the ONLY auth
// API route — there are no hand-rolled login/session endpoints.
//
// Note: this route handles authentication (issuing/clearing sessions). It is NOT
// where authorization lives. Per the OWASP/CVE-2025-29927 posture, every
// protected page, server action, and query re-verifies role + ownership at the
// data layer; this handler does not gate anything by role.

import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
