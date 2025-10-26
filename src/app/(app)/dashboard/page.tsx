import { OverviewCards } from "@/components/dashboard/overview-cards";
import { RecentJobs } from "@/components/dashboard/recent-jobs";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { mockUser } from "@/lib/data";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-headline font-bold tracking-tight">
          Welcome back, {mockUser.name}!
        </h2>
        <p className="text-muted-foreground">
          Here&apos;s a summary of your business activities.
        </p>
      </div>
      
      <OverviewCards />

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-7">
        <div className="lg:col-span-4">
            <RevenueChart />
        </div>
        <div className="lg:col-span-3">
            <RecentJobs />
        </div>
      </div>
    </div>
  );
}
