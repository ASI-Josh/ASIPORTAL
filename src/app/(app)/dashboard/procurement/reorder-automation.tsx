"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  Play,
  RefreshCw,
  Settings,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebaseClient";
import type { StockItem } from "@/lib/types";

interface Props {
  stockItems: StockItem[];
}

interface ReorderResult {
  ok: boolean;
  dryRun?: boolean;
  message?: string;
  itemsChecked: number;
  reorderNeeded: number;
  supplierCount?: number;
  purchaseOrdersCreated?: number;
  purchaseOrders: Array<{
    supplier: string;
    purchaseOrderNumber?: string;
    purchaseOrderId?: string;
    portalId?: string;
    lineItems?: Array<{
      description: string;
      quantity: number;
      unitAmount: number;
      currentStock: number;
      reorderThreshold: number;
    }>;
    estimatedTotal?: number;
    lineItemCount?: number;
    total?: number;
  }>;
  errors?: Array<{ supplier: string; error: string }>;
}

export function ReorderAutomationTab({ stockItems }: Props) {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReorderResult | null>(null);
  const [deliveryLeadDays, setDeliveryLeadDays] = useState(7);

  const itemsWithThresholds = useMemo(
    () =>
      stockItems.filter((item) => item.reorderThreshold && item.reorderThreshold > 0),
    [stockItems]
  );

  const belowThreshold = useMemo(
    () =>
      itemsWithThresholds.filter((item) => {
        const qty = item.quantityOnHand ?? 0;
        return qty <= (item.reorderThreshold ?? 0);
      }),
    [itemsWithThresholds]
  );

  const missingXeroCode = useMemo(
    () => stockItems.filter((item) => !item.xeroItemCode),
    [stockItems]
  );

  const runCheck = async (dryRun: boolean) => {
    setRunning(true);
    setResult(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/procurement/reorder", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ dryRun, deliveryLeadDays }),
      });

      const data = await res.json();
      if (!data.ok && data.error) throw new Error(data.error);

      setResult(data);
      toast({
        title: dryRun ? "Dry run complete" : "Reorder check complete",
        description: data.message || `${data.reorderNeeded || 0} items need reordering`,
      });
    } catch (err) {
      toast({
        title: "Reorder check failed",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Settings className="h-4 w-4 text-primary" />
              Configured Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{itemsWithThresholds.length}</div>
            <p className="text-xs text-muted-foreground">
              of {stockItems.length} have reorder thresholds set
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Below Threshold
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-400">{belowThreshold.length}</div>
            <p className="text-xs text-muted-foreground">items need reordering now</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Missing Xero Code
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{missingXeroCode.length}</div>
            <p className="text-xs text-muted-foreground">
              items won&apos;t link to Xero PO lines
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Run Controls */}
      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Run Reorder Check
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Scans all stock items, finds those below reorder threshold, groups by supplier, and
            creates DRAFT purchase orders in Xero. LEDGER runs this daily at 9:17 AM weekdays
            automatically.
          </p>
          <div className="flex items-end gap-4">
            <div className="grid gap-2">
              <Label>Delivery Lead Days</Label>
              <Input
                type="number"
                value={deliveryLeadDays}
                onChange={(e) => setDeliveryLeadDays(Number(e.target.value) || 7)}
                className="w-24"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => runCheck(true)}
              disabled={running}
            >
              {running ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Dry Run (Preview)
            </Button>
            <Button onClick={() => runCheck(false)} disabled={running}>
              {running ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Run &amp; Create POs
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.reorderNeeded === 0 ? (
                <CheckCircle className="h-5 w-5 text-emerald-400" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-400" />
              )}
              {result.dryRun ? "Dry Run Results" : "Reorder Results"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4 text-sm">
              <span>Items checked: <strong>{result.itemsChecked}</strong></span>
              <span>Need reorder: <strong>{result.reorderNeeded}</strong></span>
              {result.purchaseOrdersCreated !== undefined && (
                <span>POs created: <strong>{result.purchaseOrdersCreated}</strong></span>
              )}
            </div>

            {result.message && (
              <p className="text-sm text-emerald-400">{result.message}</p>
            )}

            {result.purchaseOrders.length > 0 && (
              <div className="space-y-4">
                {result.purchaseOrders.map((po, i) => (
                  <div key={i} className="rounded-lg border border-border/40 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{po.supplier}</div>
                      <div className="flex items-center gap-2">
                        {po.purchaseOrderNumber && (
                          <Badge className="bg-blue-500/20 text-blue-400">
                            {po.purchaseOrderNumber}
                          </Badge>
                        )}
                        <span className="font-bold">
                          ${(po.estimatedTotal ?? po.total ?? 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    {po.lineItems && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead className="text-right">Current</TableHead>
                            <TableHead className="text-right">Threshold</TableHead>
                            <TableHead className="text-right">Order Qty</TableHead>
                            <TableHead className="text-right">Unit $</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {po.lineItems.map((li, j) => (
                            <TableRow key={j}>
                              <TableCell>{li.description}</TableCell>
                              <TableCell className="text-right text-amber-400">
                                {li.currentStock}
                              </TableCell>
                              <TableCell className="text-right">{li.reorderThreshold}</TableCell>
                              <TableCell className="text-right font-medium">{li.quantity}</TableCell>
                              <TableCell className="text-right">${li.unitAmount.toFixed(2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                ))}
              </div>
            )}

            {result.errors && result.errors.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-red-400">Errors:</p>
                {result.errors.map((err, i) => (
                  <div key={i} className="text-sm text-red-400">
                    {err.supplier}: {err.error}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Items Without Thresholds */}
      {stockItems.length > 0 && itemsWithThresholds.length < stockItems.length && (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-amber-400">
              Items Without Reorder Thresholds
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              These items won&apos;t be included in automated reorder checks. Edit them in the Stock
              Register tab to set thresholds.
            </p>
            <div className="space-y-1">
              {stockItems
                .filter((item) => !item.reorderThreshold || item.reorderThreshold <= 0)
                .slice(0, 10)
                .map((item) => (
                  <div key={item.id} className="text-sm flex justify-between">
                    <span>{item.description}</span>
                    <span className="text-muted-foreground">{item.supplierName}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
