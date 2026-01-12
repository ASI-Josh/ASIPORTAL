"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import Image from "next/image";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [portalRole, setPortalRole] = useState<"client" | "contractor">("client");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgAbn, setOrgAbn] = useState("");
  const [orgPhone, setOrgPhone] = useState("");
  const [orgStreet, setOrgStreet] = useState("");
  const [orgSuburb, setOrgSuburb] = useState("");
  const [orgState, setOrgState] = useState("");
  const [orgPostcode, setOrgPostcode] = useState("");
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const isAsiEmail = useMemo(
    () => email.toLowerCase().trim().endsWith("@asi-australia.com.au"),
    [email]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please make sure both passwords are the same.",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      await signUp({
        email,
        password,
        name,
        phone,
        role: portalRole,
        organization: {
          name: orgName,
          abn: orgAbn,
          phone: orgPhone || phone,
          street: orgStreet,
          suburb: orgSuburb,
          state: orgState,
          postcode: orgPostcode,
        },
      });
      toast({
        title: "Account created!",
        description: "Welcome to ASI Portal.",
      });
      router.push("/");
    } catch (error: any) {
      console.error("Signup error:", error);
      let message = "Could not create account";
      if (error.code === "auth/email-already-in-use") {
        message = "This email is already registered";
      } else if (error.code === "auth/invalid-email") {
        message = "Invalid email address";
      } else if (error.code === "auth/weak-password") {
        message = "Password is too weak";
      } else if (error.message) {
        message = error.message;
      }
      toast({
        title: "Signup failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-8 bg-background relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-accent/20 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-primary/10 to-accent/10 rounded-full blur-3xl" />
        
        {/* Grid overlay for futuristic feel */}
        <div 
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                             linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: '50px 50px'
          }}
        />
      </div>

      <div className="z-10 flex flex-col items-center w-full max-w-md space-y-8">
        {/* Logo */}
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

        {/* Frosted glass signup card */}
        <div className="w-full backdrop-blur-xl bg-card/30 border border-white/10 rounded-2xl p-8 shadow-2xl shadow-black/20">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-foreground">Create Account</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Sign up to get started with ASI Portal
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-foreground/80">
                Full Name
              </Label>
              <Input
                id="name"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={loading}
                className="bg-background/50 border-white/10 focus:border-primary/50 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground/80">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@asi-australia.com.au"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                className="bg-background/50 border-white/10 focus:border-primary/50 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-foreground/80">
                Phone Number
              </Label>
              <Input
                id="phone"
                type="tel"
                placeholder="0400 123 456"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={loading}
                className="bg-background/50 border-white/10 focus:border-primary/50 transition-colors"
              />
            </div>

            {!isAsiEmail && (
              <div className="space-y-2">
                <Label className="text-foreground/80">Account Type</Label>
                <RadioGroup
                  value={portalRole}
                  onValueChange={(value) => setPortalRole(value as "client" | "contractor")}
                  className="grid gap-3 md:grid-cols-2"
                >
                  <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-background/40 p-3 cursor-pointer">
                    <RadioGroupItem value="client" id="role-client" />
                    <span className="text-sm text-foreground">Client</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-background/40 p-3 cursor-pointer">
                    <RadioGroupItem value="contractor" id="role-contractor" />
                    <span className="text-sm text-foreground">Contractor</span>
                  </label>
                </RadioGroup>
                <p className="text-xs text-muted-foreground">
                  We will automatically match your organisation by email domain if it exists.
                </p>
              </div>
            )}

            {!isAsiEmail ? (
              <div className="space-y-3 rounded-lg border border-white/10 bg-background/30 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Organisation Details</p>
                  <p className="text-xs text-muted-foreground">
                    These details help us link you to the correct organisation.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-name" className="text-foreground/80">
                    Organisation Name
                  </Label>
                  <Input
                    id="org-name"
                    type="text"
                    placeholder="Organisation name"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    required={!isAsiEmail}
                    disabled={loading}
                    className="bg-background/50 border-white/10 focus:border-primary/50 transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-abn" className="text-foreground/80">
                    ABN (Optional)
                  </Label>
                  <Input
                    id="org-abn"
                    type="text"
                    placeholder="11 222 333 444"
                    value={orgAbn}
                    onChange={(e) => setOrgAbn(e.target.value)}
                    disabled={loading}
                    className="bg-background/50 border-white/10 focus:border-primary/50 transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-phone" className="text-foreground/80">
                    Organisation Phone
                  </Label>
                  <Input
                    id="org-phone"
                    type="tel"
                    placeholder="(03) 9000 0000"
                    value={orgPhone}
                    onChange={(e) => setOrgPhone(e.target.value)}
                    required={!isAsiEmail}
                    disabled={loading}
                    className="bg-background/50 border-white/10 focus:border-primary/50 transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-street" className="text-foreground/80">
                    Street Address
                  </Label>
                  <Input
                    id="org-street"
                    type="text"
                    placeholder="123 Example Street"
                    value={orgStreet}
                    onChange={(e) => setOrgStreet(e.target.value)}
                    disabled={loading}
                    className="bg-background/50 border-white/10 focus:border-primary/50 transition-colors"
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="org-suburb" className="text-foreground/80">
                      Suburb
                    </Label>
                    <Input
                      id="org-suburb"
                      type="text"
                      placeholder="Suburb"
                      value={orgSuburb}
                      onChange={(e) => setOrgSuburb(e.target.value)}
                      required={!isAsiEmail}
                      disabled={loading}
                      className="bg-background/50 border-white/10 focus:border-primary/50 transition-colors"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-state" className="text-foreground/80">
                      State
                    </Label>
                    <Input
                      id="org-state"
                      type="text"
                      placeholder="VIC"
                      value={orgState}
                      onChange={(e) => setOrgState(e.target.value)}
                      required={!isAsiEmail}
                      disabled={loading}
                      className="bg-background/50 border-white/10 focus:border-primary/50 transition-colors"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-postcode" className="text-foreground/80">
                      Postcode
                    </Label>
                    <Input
                      id="org-postcode"
                      type="text"
                      placeholder="3000"
                      value={orgPostcode}
                      onChange={(e) => setOrgPostcode(e.target.value)}
                      disabled={loading}
                      className="bg-background/50 border-white/10 focus:border-primary/50 transition-colors"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                ASI staff accounts are automatically assigned the Technician role.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="password" className="text-foreground/80">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                minLength={6}
                className="bg-background/50 border-white/10 focus:border-primary/50 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-foreground/80">
                Confirm Password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
                minLength={6}
                className="bg-background/50 border-white/10 focus:border-primary/50 transition-colors"
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-opacity font-semibold"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating account...
                </span>
              ) : (
                "Sign Up"
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                href="/"
                className="text-primary hover:text-primary/80 transition-colors font-medium"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground/60 text-center">
          © {new Date().getFullYear()} ASI Australia. All rights reserved.
        </p>
      </div>
    </main>
  );
}
