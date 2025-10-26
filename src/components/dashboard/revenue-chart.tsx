"use client";

import { Bar, BarChart, XAxis, YAxis, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { revenueData } from "@/lib/data";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";

export function RevenueChart() {
  return (
     <Card className="bg-card/50 backdrop-blur-lg border-border/20">
      <CardHeader>
        <CardTitle>Revenue Overview</CardTitle>
        <CardDescription>Monthly revenue for the last 7 months.</CardDescription>
      </CardHeader>
      <CardContent className="pl-2">
        <ChartContainer
          config={{
            revenue: { label: "Revenue", color: "hsl(var(--primary))" },
          }}
        >
          <BarChart data={revenueData}>
            <XAxis
              dataKey="month"
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `$${value / 1000}k`}
            />
             <Tooltip 
                cursor={{ fill: 'hsl(var(--primary) / 0.1)' }}
                content={<ChartTooltipContent indicator="dot" />} 
             />
            <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
