// Browser-side Better Auth client for the (later) back-office login UI. Talks to
// the /api/auth/* handler on the same origin, so no baseURL is needed. Exposes
// the sign-in / sign-out / session hooks the login page and logout control will
// use in a later step.
//
// Authorization is never decided here — useSession is for UX only (show/hide,
// redirect). The authoritative role + ownership checks run server-side.

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export const { signIn, signOut, useSession } = authClient;
