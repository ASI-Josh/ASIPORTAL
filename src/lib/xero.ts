/**
 * Xero API wrapper with OAuth 2.0 token management.
 *
 * Env vars required:
 *   XERO_CLIENT_ID, XERO_CLIENT_SECRET
 *
 * Tokens are stored in Firestore (xeroTokens/default) and auto-refreshed.
 * The OAuth flow is initiated via GET /api/xero/auth and completed via
 * GET /api/xero/callback.
 */

import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";

// ─── Config ───────────────────────────────────────────────────────────────────

const XERO_AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";

const SCOPES = [
  "openid",
  "profile",
  "email",
  "accounting.invoices",
  "accounting.contacts",
  "accounting.settings",
  "offline_access",
].join(" ");

function getClientId() {
  const id = process.env.XERO_CLIENT_ID;
  if (!id) throw new Error("Missing XERO_CLIENT_ID env var.");
  return id;
}

function getClientSecret() {
  const secret = process.env.XERO_CLIENT_SECRET;
  if (!secret) throw new Error("Missing XERO_CLIENT_SECRET env var.");
  return secret;
}

function getRedirectUri() {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://asiportal.live";
  return `${base}/api/xero/callback`;
}

// ─── Token types ──────────────────────────────────────────────────────────────

interface XeroTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
  tenantId: string;  // Xero organisation ID
  tenantName?: string;
}

// ─── OAuth flow helpers ───────────────────────────────────────────────────────

export function getAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    state: state || "xero-auth",
  });
  return `${XERO_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<XeroTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
  });

  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${getClientId()}:${getClientSecret()}`).toString("base64")}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const tokens: Omit<XeroTokens, "tenantId" | "tenantName"> = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  // Get the connected tenant (organisation)
  const connRes = await fetch(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  const connections = await connRes.json();
  if (!Array.isArray(connections) || connections.length === 0) {
    throw new Error("No Xero organisations connected. Please connect an organisation during auth.");
  }

  const tenant = connections[0];
  const fullTokens: XeroTokens = {
    ...tokens,
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName || "",
  };

  // Store in Firestore
  await storeTokens(fullTokens);
  return fullTokens;
}

async function refreshAccessToken(current: XeroTokens): Promise<XeroTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
  });

  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${getClientId()}:${getClientSecret()}`).toString("base64")}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero token refresh failed (${res.status}): ${text}. Re-authorise at /api/xero/auth`);
  }

  const data = await res.json();
  const refreshed: XeroTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tenantId: current.tenantId,
    tenantName: current.tenantName,
  };

  await storeTokens(refreshed);
  return refreshed;
}

// ─── Token storage ────────────────────────────────────────────────────────────

async function storeTokens(tokens: XeroTokens) {
  await admin.firestore().collection(COLLECTIONS.XERO_TOKENS).doc("default").set({
    ...tokens,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function loadTokens(): Promise<XeroTokens | null> {
  const snap = await admin.firestore().collection(COLLECTIONS.XERO_TOKENS).doc("default").get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: data.expiresAt,
    tenantId: data.tenantId,
    tenantName: data.tenantName || "",
  };
}

async function getValidTokens(): Promise<XeroTokens> {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error("Xero not authorised. Visit /api/xero/auth to connect.");
  }
  // Refresh if expiring within 2 minutes
  if (Date.now() > tokens.expiresAt - 120_000) {
    return refreshAccessToken(tokens);
  }
  return tokens;
}

// ─── API call helper ──────────────────────────────────────────────────────────

async function xeroApi(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown
): Promise<unknown> {
  const tokens = await getValidTokens();
  const url = `${XERO_API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.accessToken}`,
    "xero-tenant-id": tokens.tenantId,
    Accept: "application/json",
  };
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero API ${method} ${path} failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ─── Public API functions ─────────────────────────────────────────────────────

export async function xeroGetConnectionStatus(): Promise<{
  connected: boolean;
  tenantName?: string;
  expiresAt?: number;
}> {
  const tokens = await loadTokens();
  if (!tokens) return { connected: false };
  return {
    connected: true,
    tenantName: tokens.tenantName,
    expiresAt: tokens.expiresAt,
  };
}

export async function xeroListContacts(searchTerm?: string): Promise<unknown> {
  let path = "/Contacts?page=1&pageSize=50";
  if (searchTerm) {
    path += `&where=Name.Contains("${searchTerm}")`;
  }
  return xeroApi("GET", path);
}

export async function xeroCreateInvoice(invoice: {
  contactName: string;
  contactEmail: string;
  reference: string;       // Job number e.g. "MCK-26-0023"
  dueDate: string;         // ISO date
  lineItems: Array<{
    description: string;
    quantity: number;
    unitAmount: number;     // ex-GST per unit
    accountCode?: string;   // Xero account code, default "200" (Sales)
    taxType?: string;       // default "OUTPUT" (GST on Income)
  }>;
  poNumber?: string;        // Client PO/works order number
}): Promise<{ invoiceId: string; invoiceNumber: string; status: string }> {
  // Find or create contact
  const contactResult = await xeroApi("GET",
    `/Contacts?where=Name=="${encodeURIComponent(invoice.contactName)}"`
  ) as { Contacts?: Array<{ ContactID: string }> };

  let contactId: string;
  if (contactResult.Contacts && contactResult.Contacts.length > 0) {
    contactId = contactResult.Contacts[0].ContactID;
  } else {
    // Create contact
    const newContact = await xeroApi("POST", "/Contacts", {
      Contacts: [{
        Name: invoice.contactName,
        EmailAddress: invoice.contactEmail,
      }],
    }) as { Contacts: Array<{ ContactID: string }> };
    contactId = newContact.Contacts[0].ContactID;
  }

  const payload = {
    Invoices: [{
      Type: "ACCREC", // Accounts Receivable (sales invoice)
      Contact: { ContactID: contactId },
      Reference: invoice.reference,
      DueDate: invoice.dueDate,
      LineAmountTypes: "Exclusive", // Amounts are ex-GST
      LineItems: invoice.lineItems.map((li) => ({
        Description: li.description,
        Quantity: li.quantity,
        UnitAmount: li.unitAmount,
        AccountCode: li.accountCode || "200",
        TaxType: li.taxType || "OUTPUT",
      })),
      Status: "DRAFT",
      ...(invoice.poNumber ? { LineItems_PurchaseOrderNumber: invoice.poNumber } : {}),
    }],
  };

  const result = await xeroApi("POST", "/Invoices", payload) as {
    Invoices: Array<{ InvoiceID: string; InvoiceNumber: string; Status: string }>;
  };

  const created = result.Invoices[0];
  return {
    invoiceId: created.InvoiceID,
    invoiceNumber: created.InvoiceNumber,
    status: created.Status,
  };
}

export async function xeroSendInvoice(invoiceId: string): Promise<{ sent: boolean }> {
  // First approve the invoice (move from DRAFT to AUTHORISED)
  await xeroApi("POST", "/Invoices", {
    Invoices: [{
      InvoiceID: invoiceId,
      Status: "AUTHORISED",
    }],
  });

  // Then send via email
  await xeroApi("POST", `/Invoices/${invoiceId}/Email`, {});
  return { sent: true };
}

export async function xeroGetInvoice(invoiceId: string): Promise<unknown> {
  return xeroApi("GET", `/Invoices/${invoiceId}`);
}

export async function xeroListInvoices(options?: {
  status?: string;
  contactName?: string;
  limit?: number;
}): Promise<unknown> {
  let path = "/Invoices?page=1";
  const wheres: string[] = [];
  if (options?.status) wheres.push(`Status=="${options.status}"`);
  if (options?.contactName) wheres.push(`Contact.Name.Contains("${options.contactName}")`);
  if (wheres.length > 0) path += `&where=${wheres.join("&&")}`;
  if (options?.limit) path += `&pageSize=${Math.min(options.limit, 100)}`;
  return xeroApi("GET", path);
}

export async function xeroAttachFileToInvoice(
  invoiceId: string,
  fileName: string,
  fileBytes: Uint8Array,
  contentType = "application/pdf"
): Promise<{ attachmentId: string }> {
  const tokens = await getValidTokens();
  const url = `${XERO_API_BASE}/Invoices/${invoiceId}/Attachments/${encodeURIComponent(fileName)}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      "xero-tenant-id": tokens.tenantId,
      "Content-Type": contentType,
      "Content-Length": String(fileBytes.length),
    },
    body: fileBytes,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero attachment upload failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { Attachments?: Array<{ AttachmentID: string }> };
  return { attachmentId: data.Attachments?.[0]?.AttachmentID || "" };
}
