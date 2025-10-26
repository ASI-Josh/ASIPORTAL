import { AppLogo } from "@/components/app-logo";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-background relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-accent/10 via-primary/10 to-background z-0"></div>
        <div className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 bg-accent rounded-full opacity-10 blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-primary rounded-full opacity-10 blur-3xl animate-pulse animation-delay-4000"></div>

        <div className="z-10 flex flex-col items-center space-y-8">
            <AppLogo className="h-12 w-auto text-white" />
            <LoginForm />
        </div>
    </main>
  );
}
