"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getDefaultRouteForRole } from "@/lib/auth";
import { AppLogo } from "@/components/app-logo";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      const defaultRoute = getDefaultRouteForRole(user.role);
      router.push(defaultRoute);
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 relative overflow-hidden">
      <div className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 bg-white rounded-full opacity-10 blur-3xl animate-pulse"></div>
      <div className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-white rounded-full opacity-10 blur-3xl animate-pulse"></div>

      <div className="z-10 flex flex-col items-center space-y-8 text-center">
        <AppLogo className="h-16 w-auto text-white" />
        <h1 className="text-4xl md:text-6xl font-bold text-white">
          Welcome to ASI Portal
        </h1>
        <p className="text-xl text-white/90 max-w-2xl">
          Glass & Surface Life-Extension Business Management Platform
        </p>
        <div className="flex gap-4 mt-8">
          <Link href="/login">
            <Button size="lg" variant="secondary">
              Sign In
            </Button>
          </Link>
          <Link href="/signup">
            <Button size="lg" variant="outline" className="bg-white/10 border-white text-white hover:bg-white/20">
              Sign Up
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
