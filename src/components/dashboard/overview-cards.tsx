import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Briefcase, UserPlus, ClipboardCheck } from "lucide-react";

const cardData = [
    { title: "Total Revenue", value: "$45,231.89", change: "+20.1% from last month", icon: DollarSign },
    { title: "Active Jobs", value: "+23", change: "+180.1% from last month", icon: Briefcase },
    { title: "New Leads", value: "+12", change: "+19% from last month", icon: UserPlus },
    { title: "Pending Inspections", value: "7", change: "+4 since last hour", icon: ClipboardCheck },
]

export function OverviewCards() {
    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {cardData.map((item, index) => (
                 <Card key={index} className="bg-card/50 backdrop-blur-lg border-border/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            {item.title}
                        </CardTitle>
                        <item.icon className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{item.value}</div>
                        <p className="text-xs text-muted-foreground">
                            {item.change}
                        </p>
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}
