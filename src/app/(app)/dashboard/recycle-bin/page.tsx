"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Briefcase, RotateCcw, Trash2 } from "lucide-react";

import { useJobs } from "@/contexts/JobsContext";
import { useAuth } from "@/contexts/AuthContext";
import { ADMIN_EMAILS } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

export default function RecycleBinPage() {
  const { deletedJobs, restoreJob, hardDeleteJob } = useJobs();
  const { user } = useAuth();
  const [restoringJobId, setRestoringJobId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);

  const canHardDelete =
    user?.role === "admin" || (!!user?.email && ADMIN_EMAILS.includes(user.email));

  const handleRestore = async (jobId: string) => {
    await restoreJob(jobId, user?.uid || "system");
    setRestoringJobId(null);
  };

  const handleHardDelete = async (jobId: string) => {
    await hardDeleteJob(jobId);
    setDeletingJobId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-headline font-bold tracking-tight">Recycle Bin</h2>
        <p className="text-muted-foreground">
          Restore jobs that were removed from the active workflow.
        </p>
      </div>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            Deleted Jobs
          </CardTitle>
          <CardDescription>
            {deletedJobs.length} job{deletedJobs.length !== 1 && "s"} in recycle bin
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Deleted</TableHead>
                <TableHead>Deleted By</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deletedJobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">{job.jobNumber}</TableCell>
                  <TableCell>{job.clientName}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{job.status.replace("_", " ")}</Badge>
                  </TableCell>
                  <TableCell>
                    {job.deletedAt ? format(job.deletedAt.toDate(), "PP") : "N/A"}
                  </TableCell>
                  <TableCell>{job.deletedBy || "Unknown"}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRestoringJobId(job.id)}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Restore
                    </Button>
                    {canHardDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setDeletingJobId(job.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {deletedJobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Briefcase className="h-6 w-6" />
                      No deleted jobs right now.
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!restoringJobId} onOpenChange={(open) => !open && setRestoringJobId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Job?</DialogTitle>
            <DialogDescription>
              This will return the job to the active workflow.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoringJobId(null)}>
              Cancel
            </Button>
            <Button onClick={() => restoringJobId && handleRestore(restoringJobId)}>
              Restore Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deletingJobId} onOpenChange={(open) => !open && setDeletingJobId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently Delete Job?</DialogTitle>
            <DialogDescription>
              This will permanently remove the job and related records. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingJobId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingJobId && handleHardDelete(deletingJobId)}
            >
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
