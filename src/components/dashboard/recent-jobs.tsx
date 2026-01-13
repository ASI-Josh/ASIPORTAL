import { useJobs } from "@/contexts/JobsContext";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const statusColors: { [key: string]: string } = {
    'completed': 'bg-green-500/20 text-green-400 border-green-500/30',
    'in_progress': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    'pending': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    'scheduled': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    'closed': 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    'cancelled': 'bg-red-500/20 text-red-400 border-red-500/30',
};

const statusLabels: { [key: string]: string } = {
    'completed': 'Completed',
    'in_progress': 'In Progress',
    'pending': 'Pending',
    'scheduled': 'Scheduled',
    'closed': 'Closed',
    'cancelled': 'Cancelled',
};

export function RecentJobs() {
    const { jobs } = useJobs();
    const recentJobs = [...jobs]
        .sort((a, b) => {
            const aTime = a.createdAt?.toDate?.().getTime() ?? 0;
            const bTime = b.createdAt?.toDate?.().getTime() ?? 0;
            return bTime - aTime;
        })
        .slice(0, 5);

    return (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20 h-full">
            <CardHeader>
                <CardTitle>Recent Jobs</CardTitle>
                <CardDescription>An overview of the latest job statuses.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {recentJobs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No jobs yet.</p>
                    ) : (
                        recentJobs.map((job) => (
                            <div key={job.id} className="flex items-center space-x-4">
                            <div className="flex-1">
                                <p className="text-sm font-medium leading-none">{job.jobNumber}</p>
                                <p className="text-sm text-muted-foreground">{job.clientName}</p>
                            </div>
                            <div className="text-sm text-muted-foreground">
                                {job.assignedTechnicians.length
                                    ? `Assigned: ${job.assignedTechnicians.length}`
                                    : "Unassigned"}
                            </div>
                            <Badge variant="outline" className={cn("text-xs", statusColors[job.status])}>
                                {statusLabels[job.status]}
                            </Badge>
                        </div>
                        ))
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
