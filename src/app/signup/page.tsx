"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function SignupPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-8 bg-background relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-accent/20 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-primary/10 to-accent/10 rounded-full blur-3xl" />
      </div>

      <div className="z-10 flex flex-col items-center w-full max-w-md space-y-8">
        <div className="flex flex-col items-center space-y-4">
          <Image
            src="/logos/ASI BRANDING - OFFICIAL MAIN.png"
            alt="ASI Logo"
            width={4000}
            height={1600}
            className="h-[400px] w-auto"
            priority
          />
          <p className="text-muted-foreground text-center text-sm">
            Glass & Surface Life-Extension Business Management
          </p>
        </div>

        <div className="w-full backdrop-blur-xl bg-card/30 border border-white/10 rounded-2xl p-8 shadow-2xl shadow-black/20 text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Access by Invitation</h1>
          <p className="text-muted-foreground text-sm">
            New accounts are created by ASI administrators. Please email support to request access.
          </p>
          <Button asChild className="w-full">
            <Link href="mailto:support@asi-australia.com.au">
              Email support@asi-australia.com.au
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href="/">Back to sign in</Link>
          </Button>
        </div>

        <p className="text-xs text-muted-foreground/60 text-center">
          Ac {new Date().getFullYear()} ASI Australia. All rights reserved.
        </p>
      </div>
    </main>
  );
}
