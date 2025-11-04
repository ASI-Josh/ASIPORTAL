import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicPaths = ["/login", "/signup", "/"];
const authRequiredPaths = ["/dashboard", "/client", "/technician", "/contractor"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (publicPaths.some((path) => pathname === path)) {
    return NextResponse.next();
  }

  // Allow static files and API routes
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Check if user is authenticated (we'll use session cookie later)
  // For now, this is a placeholder - authentication is handled client-side
  // Once we add server-side session management, we'll check here

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
