import type { Lead } from "@/lib/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DollarSign, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface LeadCardProps {
  lead: Lead;
}

export function LeadCard({ lead }: LeadCardProps) {
  return (
    <Card className={cn(
        "bg-background/50 backdrop-blur-md border-border/20",
        "hover:shadow-lg hover:border-primary/50 transition-all cursor-grab active:cursor-grabbing"
    )}>
      <CardHeader className="p-4">
        <div className="flex items-start justify-between">
          <p className="font-bold text-base text-foreground">{lead.companyName}</p>
          <div className="flex items-center text-sm font-semibold bg-gradient-to-r from-accent to-primary bg-clip-text text-transparent">
            <DollarSign className="h-4 w-4 text-primary" />
            <span>{lead.value.toLocaleString()}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <span>{lead.contactPerson}</span>
            </div>
            <Avatar className="h-8 w-8">
                <AvatarImage src={lead.avatarUrl} alt={lead.contactPerson} data-ai-hint="person portrait" />
                <AvatarFallback>{lead.contactPerson.charAt(0)}</AvatarFallback>
            </Avatar>
        </div>
      </CardContent>
    </Card>
  );
}
