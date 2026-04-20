/**
 * ASI Xero MCP Server
 *
 * Dedicated MCP endpoint for Xero tooling. LEDGER + Athena register
 * this as a separate Claude connector so the Xero tool surface doesn't
 * eat into the main ASI Portal MCP's tool budget.
 *
 * Same JSON-RPC 2.0 protocol + SSE transport as /api/mcp. Auth via
 * bearer token against XERO_MCP_SECRET (falls back to MCP_SECRET if
 * XERO_MCP_SECRET is not configured — lets us roll this out without a
 * new env var on day one).
 */

import { NextRequest, NextResponse } from "next/server";
import { XERO_TOOLS, callXeroTool } from "@/lib/server/xero-mcp-tools";

// Critical runtime config — same treatment as the main MCP route so this
// endpoint is stable under Netlify (nodejs runtime + 60s max duration +
// force-dynamic to stop Next prerendering the POST route).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─── Types ───────────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.XERO_MCP_SECRET || process.env.MCP_SECRET;
  if (!secret) return false;
  // Bearer token
  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === secret) return true;
  // Custom header
  if (req.headers.get("x-mcp-secret") === secret) return true;
  // Query param (for Claude Desktop url mode)
  const token = new URL(req.url).searchParams.get("token");
  if (token === secret) return true;
  return false;
}

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

function rpcOk(id: string | number | null, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: string | number | null, code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });
}

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const { id, method, params = {} } = body;

  try {
    switch (method) {
      case "initialize":
        return rpcOk(id, {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "asi-portal-xero", version: "1.0.0" },
        });

      case "tools/list":
        return rpcOk(id, { tools: XERO_TOOLS });

      case "tools/call": {
        const toolName = String((params as { name?: unknown }).name || "");
        const toolArgs = ((params as { arguments?: unknown }).arguments || {}) as Record<string, unknown>;
        const result = await callXeroTool(toolName, toolArgs);
        return rpcOk(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      }

      case "ping":
        return rpcOk(id, {});

      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return rpcError(id, -32603, message);
  }
}

// SSE transport — required by mcp-remote (Claude Desktop proxy)
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return new Response("Unauthorised.", { status: 401 });
  }

  const url = new URL(req.url);
  const encoder = new TextEncoder();

  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`event: endpoint\ndata: ${url.pathname}\n\n`)
      );
      timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        } catch {
          if (timer) clearInterval(timer);
          timer = null;
        }
      }, 15000);
    },
    cancel() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  });

  req.signal.addEventListener("abort", () => {
    if (timer) clearInterval(timer);
    timer = null;
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
