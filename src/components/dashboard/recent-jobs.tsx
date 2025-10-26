import { mockJobs } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const statusColors: { [key: string]: string } = {
    'Completed': 'bg-green-500/20 text-green-400 border-green-500/30',
    'In Progress': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    'Pending': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};


export function RecentJobs() {
    return (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20 h-full">
            <CardHeader>
                <CardTitle>Recent Jobs</CardTitle>
                <CardDescription>An overview of the latest job statuses.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {mockJobs.map(job => (
                        <div key={job.id} className="flex items-center space-x-4">
                            <div className="flex-1">
                                <p className="text-sm font-medium leading-none">{job.title}</p>
                                <p className="text-sm text-muted-foreground">{job.client}</p>
                            </div>
                            <div className="text-sm text-muted-foreground">{job.assigned}</div>
                            <Badge variant="outline" className={cn("text-xs", statusColors[job.status])}>
                                {job.status}
                            </Badge>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
