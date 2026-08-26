import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Route protection: everything except /login (and the auth API) requires a
// session. Next 16: this file replaces middleware.ts and runs on Node.js.
//
// M6 adds /api/line/* to the exclusions — the LINE webhook and the
// published-photo route are reached by LINE's servers and by customers'
// phones, so no session can exist. They are not unprotected: the webhook
// verifies an HMAC signature against the Shop's channel secret (ADR-005) and
// the photo route requires an unguessable per-publication token minted only
// when a human pressed send (M6 brief, decision 3).
export const proxy = auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }
});

export const config = {
  matcher: ["/((?!api/auth|api/line|_next/static|_next/image|favicon\\.ico).*)"],
};
