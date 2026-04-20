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

// Xero OAuth scopes — every scope here must ALSO be enabled in the Xero
// Developer Portal app config (developer.xero.com → ASI Portal app →
// Configuration → OAuth 2.0 scopes). Xero rejects the auth request with
// "unauthorized_client: Invalid scope for client" if the app isn't
// configured for a scope we ask for.
// Xero OAuth scopes — granular scope model (apps created after
// 2 March 2026). Deliberately MINIMAL right now while we diagnose
// "Invalid scope for client". Starting with just OpenID + offline
// + contacts.read — the absolute minimum that a known-working Xero
// app always supports. If this succeeds, we add scopes back one
// step at a time.
//
// Reference: developer.xero.com/documentation/guides/oauth2/scopes
const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.contacts.read",
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
    // Force Xero to re-display the consent screen every time. Without this,
    // if the org owner previously approved the app, Xero silently issues a
    // token with the EXISTING grant and ignores any new scopes we added to
    // the request — the classic "token refreshes but still 401s on new
    // endpoints" symptom.
    prompt: "consent",
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

  // Some Xero endpoints (e.g. /Email) return empty body
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { rawResponse: text };
  }
}

// ─── Public API functions ─────────────────────────────────────────────────────

export async function xeroGetConnectionStatus(): Promise<{
  connected: boolean;
  tenantName?: string;
  expiresAt?: number;
  grantedScopes?: string[];
  missingScopes?: string[];
  scopesMatchConfig?: boolean;
}> {
  const tokens = await loadTokens();
  if (!tokens) return { connected: false };

  // Decode the JWT access token (no verification — we just want the scope
  // claim for diagnostics). Xero access tokens are standard JWTs so the
  // middle segment is a base64url-encoded JSON payload.
  let grantedScopes: string[] = [];
  try {
    const parts = tokens.accessToken.split(".");
    if (parts.length === 3) {
      const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payloadJson = Buffer.from(payloadB64, "base64").toString("utf-8");
      const payload = JSON.parse(payloadJson) as { scope?: string | string[] };
      if (Array.isArray(payload.scope)) {
        grantedScopes = payload.scope;
      } else if (typeof payload.scope === "string") {
        grantedScopes = payload.scope.split(" ").filter(Boolean);
      }
    }
  } catch {
    // Decoding failed — leave grantedScopes empty; caller can see scopesMatchConfig=false
  }

  const configured = SCOPES.split(" ").filter(Boolean);
  const missingScopes = configured.filter((s) => !grantedScopes.includes(s));

  return {
    connected: true,
    tenantName: tokens.tenantName,
    expiresAt: tokens.expiresAt,
    grantedScopes,
    missingScopes,
    scopesMatchConfig: missingScopes.length === 0,
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
}): Promise<{ invoiceId: string; invoiceNumber: string; status: string; contactId: string }> {
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
    contactId,
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

/**
 * Set the primary email on a Xero contact so the next invoice email
 * goes to the right person. Call BEFORE xeroSendInvoice.
 *
 * - `primaryEmail` becomes the contact's main EmailAddress (Xero sends invoices here).
 * - `additionalEmails` are added as ContactPersons with IncludeInEmails=true.
 *   Existing contact persons with IncludeInEmails=false are preserved.
 */
export async function xeroSetInvoiceRecipients(
  contactId: string,
  primaryEmail: string,
  additionalEmails: string[] = []
): Promise<void> {
  // Get existing contact persons so we don't blow them away
  const existing = await xeroApi("GET", `/Contacts/${contactId}`) as {
    Contacts?: Array<{
      ContactPersons?: Array<{
        FirstName: string;
        LastName: string;
        EmailAddress: string;
        IncludeInEmails: boolean;
      }>;
    }>;
  };

  const existingPersons = existing.Contacts?.[0]?.ContactPersons || [];

  // Keep existing persons but set all IncludeInEmails to false first
  const updatedPersons = existingPersons.map((p) => ({
    ...p,
    IncludeInEmails: false,
  }));

  // Add/update our target additional emails with IncludeInEmails=true
  for (const email of additionalEmails) {
    const normalised = email.toLowerCase().trim();
    if (normalised === primaryEmail.toLowerCase().trim()) continue; // skip if same as primary
    const idx = updatedPersons.findIndex(
      (p) => p.EmailAddress?.toLowerCase().trim() === normalised
    );
    if (idx >= 0) {
      updatedPersons[idx].IncludeInEmails = true;
    } else {
      updatedPersons.push({
        FirstName: "",
        LastName: "",
        EmailAddress: email,
        IncludeInEmails: true,
      });
    }
  }

  await xeroApi("POST", "/Contacts", {
    Contacts: [{
      ContactID: contactId,
      EmailAddress: primaryEmail,
      ...(updatedPersons.length > 0 ? { ContactPersons: updatedPersons } : {}),
    }],
  });
}

export async function xeroGetInvoice(invoiceId: string): Promise<unknown> {
  return xeroApi("GET", `/Invoices/${invoiceId}`);
}

export async function xeroListInvoices(options?: {
  status?: string;           // e.g. "DRAFT", "AUTHORISED", "PAID", "VOIDED"
  contactName?: string;      // Partial name match
  type?: "ACCREC" | "ACCPAY"; // Sales (AR) or Bills (AP)
  reference?: string;        // Match on Reference field (e.g. job number or supplier invoice #)
  invoiceNumber?: string;    // Exact invoice number match (e.g. "INV-0253")
  dateFrom?: string;         // ISO date — invoices on/after this date
  dateTo?: string;           // ISO date — invoices on/before this date
  limit?: number;
}): Promise<unknown> {
  let path = "/Invoices?page=1";
  const wheres: string[] = [];
  if (options?.status) wheres.push(`Status=="${options.status}"`);
  if (options?.type) wheres.push(`Type=="${options.type}"`);
  if (options?.contactName) wheres.push(`Contact.Name.Contains("${options.contactName}")`);
  if (options?.reference) wheres.push(`Reference.Contains("${options.reference}")`);
  if (options?.invoiceNumber) wheres.push(`InvoiceNumber=="${options.invoiceNumber}"`);
  if (options?.dateFrom) wheres.push(`Date>=DateTime(${options.dateFrom.replace(/-/g, ",")})`);
  if (options?.dateTo) wheres.push(`Date<=DateTime(${options.dateTo.replace(/-/g, ",")})`);
  if (wheres.length > 0) path += `&where=${encodeURIComponent(wheres.join("&&"))}`;
  if (options?.limit) path += `&pageSize=${Math.min(options.limit, 100)}`;
  return xeroApi("GET", path);
}

/**
 * Update an existing invoice. Supports editing line items, reference,
 * due date, status (e.g. to void), and contact. The invoice must not be PAID.
 *
 * To void an invoice entirely, use xeroVoidInvoice instead.
 */
export async function xeroUpdateInvoice(update: {
  invoiceId: string;
  reference?: string;
  dueDate?: string;
  status?: "DRAFT" | "SUBMITTED" | "AUTHORISED" | "DELETED" | "VOIDED";
  lineItems?: Array<{
    lineItemId?: string;    // Include to update existing line; omit to add new
    description: string;
    quantity: number;
    unitAmount: number;
    accountCode?: string;
    taxType?: string;
  }>;
}): Promise<{ invoiceId: string; invoiceNumber: string; status: string; total: number }> {
  const payload: Record<string, unknown> = {
    InvoiceID: update.invoiceId,
  };
  if (update.reference !== undefined) payload.Reference = update.reference;
  if (update.dueDate !== undefined) payload.DueDate = update.dueDate;
  if (update.status !== undefined) payload.Status = update.status;
  if (update.lineItems !== undefined) {
    payload.LineItems = update.lineItems.map((li) => ({
      ...(li.lineItemId ? { LineItemID: li.lineItemId } : {}),
      Description: li.description,
      Quantity: li.quantity,
      UnitAmount: li.unitAmount,
      AccountCode: li.accountCode || "200",
      TaxType: li.taxType || "OUTPUT",
    }));
  }

  const result = await xeroApi("POST", "/Invoices", {
    Invoices: [payload],
  }) as {
    Invoices: Array<{ InvoiceID: string; InvoiceNumber: string; Status: string; Total: number }>;
  };

  const updated = result.Invoices[0];
  return {
    invoiceId: updated.InvoiceID,
    invoiceNumber: updated.InvoiceNumber,
    status: updated.Status,
    total: updated.Total,
  };
}

/**
 * Void an invoice. Only works on DRAFT or SUBMITTED invoices that haven't
 * been paid. Paid/authorised invoices with payments need a credit note instead.
 */
export async function xeroVoidInvoice(invoiceId: string): Promise<{ voided: boolean; status: string }> {
  const result = await xeroApi("POST", "/Invoices", {
    Invoices: [{
      InvoiceID: invoiceId,
      Status: "VOIDED",
    }],
  }) as { Invoices: Array<{ Status: string }> };
  return { voided: true, status: result.Invoices[0].Status };
}

/**
 * Create a credit note (AR refund/adjustment or AP supplier credit).
 * Optionally allocate it to an existing invoice/bill in one call.
 */
export async function xeroCreateCreditNote(creditNote: {
  type: "ACCRECCREDIT" | "ACCPAYCREDIT"; // Sales credit (customer refund) or Bill credit (supplier credit)
  contactName: string;
  reference?: string;
  date: string;           // ISO date
  lineItems: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    accountCode?: string;
    taxType?: string;
  }>;
  status?: "DRAFT" | "AUTHORISED";
  allocateToInvoiceId?: string; // If set, allocate the full credit note amount to this invoice
}): Promise<{
  creditNoteId: string;
  creditNoteNumber: string;
  status: string;
  total: number;
  allocated?: boolean;
}> {
  // Find or create contact
  const contactResult = await xeroApi("GET",
    `/Contacts?where=Name=="${encodeURIComponent(creditNote.contactName)}"`
  ) as { Contacts?: Array<{ ContactID: string }> };

  let contactId: string;
  if (contactResult.Contacts && contactResult.Contacts.length > 0) {
    contactId = contactResult.Contacts[0].ContactID;
  } else {
    const newContact = await xeroApi("POST", "/Contacts", {
      Contacts: [{ Name: creditNote.contactName }],
    }) as { Contacts: Array<{ ContactID: string }> };
    contactId = newContact.Contacts[0].ContactID;
  }

  // Default account/tax codes based on credit type
  const isAR = creditNote.type === "ACCRECCREDIT";
  const defaultAccount = isAR ? "200" : "310";
  const defaultTax = isAR ? "OUTPUT" : "INPUT";

  const payload = {
    CreditNotes: [{
      Type: creditNote.type,
      Contact: { ContactID: contactId },
      Date: creditNote.date,
      ...(creditNote.reference ? { Reference: creditNote.reference } : {}),
      LineAmountTypes: "Exclusive",
      Status: creditNote.status || "DRAFT",
      LineItems: creditNote.lineItems.map((li) => ({
        Description: li.description,
        Quantity: li.quantity,
        UnitAmount: li.unitAmount,
        AccountCode: li.accountCode || defaultAccount,
        TaxType: li.taxType || defaultTax,
      })),
    }],
  };

  const result = await xeroApi("PUT", "/CreditNotes", payload) as {
    CreditNotes: Array<{
      CreditNoteID: string;
      CreditNoteNumber: string;
      Status: string;
      Total: number;
    }>;
  };

  const created = result.CreditNotes[0];
  let allocated = false;

  // Optionally allocate to an invoice
  if (creditNote.allocateToInvoiceId && created.Status === "AUTHORISED") {
    await xeroApi("PUT", `/CreditNotes/${created.CreditNoteID}/Allocations`, {
      Allocations: [{
        Invoice: { InvoiceID: creditNote.allocateToInvoiceId },
        Amount: created.Total,
        Date: creditNote.date,
      }],
    });
    allocated = true;
  }

  return {
    creditNoteId: created.CreditNoteID,
    creditNoteNumber: created.CreditNoteNumber,
    status: created.Status,
    total: created.Total,
    allocated,
  };
}

/**
 * Record a payment against an existing invoice or bill. Marks the document
 * as PAID (or partially paid) and creates a payment record against a bank
 * account.
 */
export async function xeroRecordPayment(payment: {
  invoiceId: string;      // InvoiceID of the invoice or bill being paid
  accountName: string;    // Bank/payment account name (e.g. "Mastercard", "ANZ Business")
  date: string;           // Payment date (ISO)
  amount: number;         // Payment amount (inc GST)
  reference?: string;     // Payment reference
}): Promise<{ paymentId: string; status: string; amount: number }> {
  // Look up the account by name
  const accountsResult = await xeroApi("GET",
    `/Accounts?where=Name=="${encodeURIComponent(payment.accountName)}"`
  ) as { Accounts?: Array<{ AccountID: string }> };

  const accountId = accountsResult.Accounts?.[0]?.AccountID;
  if (!accountId) {
    throw new Error(`Payment account '${payment.accountName}' not found in Xero.`);
  }

  const result = await xeroApi("PUT", "/Payments", {
    Payments: [{
      Invoice: { InvoiceID: payment.invoiceId },
      Account: { AccountID: accountId },
      Date: payment.date,
      Amount: payment.amount,
      ...(payment.reference ? { Reference: payment.reference } : {}),
    }],
  }) as {
    Payments: Array<{ PaymentID: string; Status: string; Amount: number }>;
  };

  const created = result.Payments[0];
  return {
    paymentId: created.PaymentID,
    status: created.Status,
    amount: created.Amount,
  };
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
    body: Buffer.from(fileBytes),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero attachment upload failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { Attachments?: Array<{ AttachmentID: string }> };
  return { attachmentId: data.Attachments?.[0]?.AttachmentID || "" };
}

// ─── Purchase Orders ──────────────────────────────────────────────────────────

export async function xeroCreatePurchaseOrder(po: {
  contactName: string;
  reference?: string;
  deliveryDate?: string;
  lineItems: Array<{
    itemCode?: string;
    description: string;
    quantity: number;
    unitAmount: number;
    accountCode?: string;
    taxType?: string;
  }>;
}): Promise<{ purchaseOrderId: string; purchaseOrderNumber: string; status: string }> {
  // Find or create supplier contact
  const contactResult = await xeroApi("GET",
    `/Contacts?where=Name=="${encodeURIComponent(po.contactName)}"`
  ) as { Contacts?: Array<{ ContactID: string }> };

  let contactId: string;
  if (contactResult.Contacts && contactResult.Contacts.length > 0) {
    contactId = contactResult.Contacts[0].ContactID;
  } else {
    const newContact = await xeroApi("POST", "/Contacts", {
      Contacts: [{ Name: po.contactName }],
    }) as { Contacts: Array<{ ContactID: string }> };
    contactId = newContact.Contacts[0].ContactID;
  }

  const payload = {
    PurchaseOrders: [{
      Contact: { ContactID: contactId },
      Reference: po.reference || "",
      DeliveryDate: po.deliveryDate || undefined,
      LineAmountTypes: "Exclusive",
      Status: "DRAFT",
      LineItems: po.lineItems.map((li) => ({
        ItemCode: li.itemCode || undefined,
        Description: li.description,
        Quantity: li.quantity,
        UnitAmount: li.unitAmount,
        AccountCode: li.accountCode || "300",
        TaxType: li.taxType || "INPUT",
      })),
    }],
  };

  const result = await xeroApi("POST", "/PurchaseOrders", payload) as {
    PurchaseOrders: Array<{ PurchaseOrderID: string; PurchaseOrderNumber: string; Status: string }>;
  };

  const created = result.PurchaseOrders[0];
  return {
    purchaseOrderId: created.PurchaseOrderID,
    purchaseOrderNumber: created.PurchaseOrderNumber,
    status: created.Status,
  };
}

export async function xeroSendPurchaseOrder(purchaseOrderId: string): Promise<{ sent: boolean }> {
  await xeroApi("POST", "/PurchaseOrders", {
    PurchaseOrders: [{
      PurchaseOrderID: purchaseOrderId,
      Status: "AUTHORISED",
    }],
  });
  await xeroApi("POST", `/PurchaseOrders/${purchaseOrderId}/Email`, {});
  return { sent: true };
}

export async function xeroGetPurchaseOrder(purchaseOrderId: string): Promise<unknown> {
  return xeroApi("GET", `/PurchaseOrders/${purchaseOrderId}`);
}

// ─── Bills (Accounts Payable) ────────────────────────────────────────────────

export async function xeroCreateBill(bill: {
  contactName: string;
  contactEmail?: string;
  reference: string;        // Supplier invoice number
  date: string;             // Bill date ISO
  dueDate: string;          // Due date ISO
  lineItems: Array<{
    description: string;
    quantity: number;
    unitAmount: number;       // ex-GST
    accountCode?: string;     // Default '310' (Cost of Goods Sold)
    taxType?: string;         // Default 'INPUT' (GST on Expenses)
    itemCode?: string;
  }>;
  status?: "DRAFT" | "AUTHORISED";
  paidDate?: string;
  paidAccount?: string;       // Account name e.g. 'Mastercard'
}): Promise<{ billId: string; billNumber: string; status: string; total: number }> {
  // Find or create supplier contact
  const contactResult = await xeroApi("GET",
    `/Contacts?where=Name=="${encodeURIComponent(bill.contactName)}"`
  ) as { Contacts?: Array<{ ContactID: string }> };

  let contactId: string;
  if (contactResult.Contacts && contactResult.Contacts.length > 0) {
    contactId = contactResult.Contacts[0].ContactID;
  } else {
    const newContact = await xeroApi("POST", "/Contacts", {
      Contacts: [{
        Name: bill.contactName,
        ...(bill.contactEmail ? { EmailAddress: bill.contactEmail } : {}),
      }],
    }) as { Contacts: Array<{ ContactID: string }> };
    contactId = newContact.Contacts[0].ContactID;
  }

  const payload = {
    Invoices: [{
      Type: "ACCPAY", // Accounts Payable (supplier bill)
      Contact: { ContactID: contactId },
      Reference: bill.reference,
      Date: bill.date,
      DueDate: bill.dueDate,
      LineAmountTypes: "Exclusive",
      Status: bill.status || "DRAFT",
      LineItems: bill.lineItems.map((li) => ({
        Description: li.description,
        Quantity: li.quantity,
        UnitAmount: li.unitAmount,
        AccountCode: li.accountCode || "310",
        TaxType: li.taxType || "INPUT",
        ...(li.itemCode ? { ItemCode: li.itemCode } : {}),
      })),
    }],
  };

  const result = await xeroApi("POST", "/Invoices", payload) as {
    Invoices: Array<{
      InvoiceID: string;
      InvoiceNumber: string;
      Status: string;
      Total: number;
    }>;
  };

  const created = result.Invoices[0];
  let finalStatus = created.Status;

  // Record payment if requested
  if (bill.paidDate && (finalStatus === "AUTHORISED")) {
    // Look up the payment account by name
    let accountId: string | undefined;
    if (bill.paidAccount) {
      const accountsResult = await xeroApi("GET",
        `/Accounts?where=Name=="${encodeURIComponent(bill.paidAccount)}"`
      ) as { Accounts?: Array<{ AccountID: string }> };
      accountId = accountsResult.Accounts?.[0]?.AccountID;
      if (!accountId) {
        throw new Error(`Payment account '${bill.paidAccount}' not found in Xero. Check the account name matches exactly.`);
      }
    }

    await xeroApi("PUT", "/Payments", {
      Payments: [{
        Invoice: { InvoiceID: created.InvoiceID },
        Account: { AccountID: accountId },
        Date: bill.paidDate,
        Amount: created.Total,
      }],
    });
    finalStatus = "PAID";
  }

  return {
    billId: created.InvoiceID,
    billNumber: created.InvoiceNumber,
    status: finalStatus,
    total: created.Total,
  };
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export type XeroReportType =
  | "ProfitAndLoss"
  | "BalanceSheet"
  | "TrialBalance"
  | "AgedReceivablesByContact"
  | "AgedPayablesByContact"
  | "BankSummary"
  | "BudgetSummary"
  | "ExecutiveSummary"
  | "BASReport"
  | "GSTReport"
  | "TenNinetyNine";

/**
 * Fetch a standard report from Xero. The Reports API is stable across
 * all report types — ATHENA can use this for weekly/monthly financial
 * pulls (P&L, aged receivables, balance sheet, etc.) and BAS prep.
 *
 * Dates should be ISO format (YYYY-MM-DD). Not all params apply to all
 * reports — see Xero docs for per-report specifics. Unused params are
 * ignored silently by Xero.
 */
export async function xeroGetReport(options: {
  reportType: XeroReportType;
  fromDate?: string;        // e.g. P&L period start
  toDate?: string;          // e.g. P&L period end
  date?: string;            // Balance Sheet / Aged Reports as-at date
  periods?: number;         // Comparison periods (P&L, BS)
  timeframe?: "MONTH" | "QUARTER" | "YEAR";
  trackingCategoryId?: string;
  trackingOptionId?: string;
  standardLayout?: boolean;
  paymentsOnly?: boolean;   // BAS / cash basis
}): Promise<unknown> {
  const params = new URLSearchParams();
  if (options.fromDate) params.set("fromDate", options.fromDate);
  if (options.toDate) params.set("toDate", options.toDate);
  if (options.date) params.set("date", options.date);
  if (options.periods !== undefined) params.set("periods", String(options.periods));
  if (options.timeframe) params.set("timeframe", options.timeframe);
  if (options.trackingCategoryId) params.set("trackingCategoryID", options.trackingCategoryId);
  if (options.trackingOptionId) params.set("trackingOptionID", options.trackingOptionId);
  if (options.standardLayout !== undefined) params.set("standardLayout", String(options.standardLayout));
  if (options.paymentsOnly !== undefined) params.set("paymentsOnly", String(options.paymentsOnly));

  const qs = params.toString();
  const path = `/Reports/${options.reportType}${qs ? `?${qs}` : ""}`;
  return xeroApi("GET", path);
}

// ─── Accounts (Chart of Accounts) ────────────────────────────────────────────

export async function xeroListAccounts(options?: {
  type?: string;        // e.g. "BANK", "REVENUE", "EXPENSE", "CURRLIAB"
  status?: string;      // "ACTIVE" | "ARCHIVED"
  name?: string;        // Partial name match
}): Promise<unknown> {
  let path = "/Accounts";
  const wheres: string[] = [];
  if (options?.type) wheres.push(`Type=="${options.type}"`);
  if (options?.status) wheres.push(`Status=="${options.status}"`);
  if (options?.name) wheres.push(`Name.Contains("${options.name}")`);
  if (wheres.length > 0) path += `?where=${encodeURIComponent(wheres.join("&&"))}`;
  return xeroApi("GET", path);
}

export async function xeroCreateAccount(account: {
  code: string;
  name: string;
  type: string;              // e.g. "EXPENSE", "REVENUE", "CURRLIAB", "BANK"
  description?: string;
  taxType?: string;
  enablePaymentsToAccount?: boolean;
  showInExpenseClaims?: boolean;
}): Promise<{ accountId: string; code: string; name: string; status: string }> {
  const payload = {
    Code: account.code,
    Name: account.name,
    Type: account.type,
    ...(account.description ? { Description: account.description } : {}),
    ...(account.taxType ? { TaxType: account.taxType } : {}),
    ...(account.enablePaymentsToAccount !== undefined ? { EnablePaymentsToAccount: account.enablePaymentsToAccount } : {}),
    ...(account.showInExpenseClaims !== undefined ? { ShowInExpenseClaims: account.showInExpenseClaims } : {}),
  };
  const result = await xeroApi("PUT", "/Accounts", payload) as {
    Accounts: Array<{ AccountID: string; Code: string; Name: string; Status: string }>;
  };
  const created = result.Accounts[0];
  return {
    accountId: created.AccountID,
    code: created.Code,
    name: created.Name,
    status: created.Status,
  };
}

export async function xeroUpdateAccount(update: {
  accountId: string;
  code?: string;
  name?: string;
  description?: string;
  taxType?: string;
  status?: "ACTIVE" | "ARCHIVED";
}): Promise<{ accountId: string; status: string }> {
  const payload: Record<string, unknown> = {};
  if (update.code !== undefined) payload.Code = update.code;
  if (update.name !== undefined) payload.Name = update.name;
  if (update.description !== undefined) payload.Description = update.description;
  if (update.taxType !== undefined) payload.TaxType = update.taxType;
  if (update.status !== undefined) payload.Status = update.status;

  const result = await xeroApi("POST", `/Accounts/${update.accountId}`, payload) as {
    Accounts: Array<{ AccountID: string; Status: string }>;
  };
  return {
    accountId: result.Accounts[0].AccountID,
    status: result.Accounts[0].Status,
  };
}

export async function xeroArchiveAccount(accountId: string): Promise<{ accountId: string; status: string }> {
  return xeroUpdateAccount({ accountId, status: "ARCHIVED" });
}

// ─── Manual Journals ─────────────────────────────────────────────────────────

/**
 * Create a manual journal entry. Use for period-end adjustments, accruals,
 * depreciation, corrections, and anything that doesn't flow through
 * invoicing/billing. Debits and credits MUST balance.
 */
export async function xeroCreateManualJournal(journal: {
  narration: string;
  date: string;              // ISO
  status?: "DRAFT" | "POSTED";
  lineAmountTypes?: "Exclusive" | "Inclusive" | "NoTax";
  journalLines: Array<{
    description?: string;
    accountCode: string;
    lineAmount: number;      // Positive = debit, negative = credit
    taxType?: string;
    trackingCategoryName?: string;
    trackingOptionName?: string;
  }>;
}): Promise<{ manualJournalId: string; status: string }> {
  // Sanity check: debits and credits should balance (sum to zero)
  const total = journal.journalLines.reduce((sum, l) => sum + l.lineAmount, 0);
  if (Math.abs(total) > 0.01) {
    throw new Error(`Journal lines do not balance — total = ${total.toFixed(2)}. Debits (positive) must equal credits (negative).`);
  }

  const payload = {
    ManualJournals: [{
      Narration: journal.narration,
      Date: journal.date,
      Status: journal.status || "DRAFT",
      LineAmountTypes: journal.lineAmountTypes || "NoTax",
      JournalLines: journal.journalLines.map((l) => ({
        ...(l.description ? { Description: l.description } : {}),
        AccountCode: l.accountCode,
        LineAmount: l.lineAmount,
        ...(l.taxType ? { TaxType: l.taxType } : {}),
        ...(l.trackingCategoryName && l.trackingOptionName ? {
          Tracking: [{ Name: l.trackingCategoryName, Option: l.trackingOptionName }],
        } : {}),
      })),
    }],
  };

  const result = await xeroApi("PUT", "/ManualJournals", payload) as {
    ManualJournals: Array<{ ManualJournalID: string; Status: string }>;
  };
  return {
    manualJournalId: result.ManualJournals[0].ManualJournalID,
    status: result.ManualJournals[0].Status,
  };
}

// ─── Quotes ──────────────────────────────────────────────────────────────────

export async function xeroCreateQuote(quote: {
  contactName: string;
  contactEmail?: string;
  date: string;
  expiryDate?: string;
  reference?: string;
  title?: string;
  summary?: string;
  terms?: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    accountCode?: string;
    taxType?: string;
    itemCode?: string;
  }>;
  status?: "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED";
}): Promise<{ quoteId: string; quoteNumber: string; status: string; total: number }> {
  // Find or create contact
  const contactResult = await xeroApi("GET",
    `/Contacts?where=Name=="${encodeURIComponent(quote.contactName)}"`
  ) as { Contacts?: Array<{ ContactID: string }> };

  let contactId: string;
  if (contactResult.Contacts && contactResult.Contacts.length > 0) {
    contactId = contactResult.Contacts[0].ContactID;
  } else {
    const newContact = await xeroApi("POST", "/Contacts", {
      Contacts: [{
        Name: quote.contactName,
        ...(quote.contactEmail ? { EmailAddress: quote.contactEmail } : {}),
      }],
    }) as { Contacts: Array<{ ContactID: string }> };
    contactId = newContact.Contacts[0].ContactID;
  }

  const payload = {
    Quotes: [{
      Contact: { ContactID: contactId },
      Date: quote.date,
      ...(quote.expiryDate ? { ExpiryDate: quote.expiryDate } : {}),
      ...(quote.reference ? { Reference: quote.reference } : {}),
      ...(quote.title ? { Title: quote.title } : {}),
      ...(quote.summary ? { Summary: quote.summary } : {}),
      ...(quote.terms ? { Terms: quote.terms } : {}),
      Status: quote.status || "DRAFT",
      LineAmountTypes: "Exclusive",
      LineItems: quote.lineItems.map((li) => ({
        Description: li.description,
        Quantity: li.quantity,
        UnitAmount: li.unitAmount,
        AccountCode: li.accountCode || "200",
        TaxType: li.taxType || "OUTPUT",
        ...(li.itemCode ? { ItemCode: li.itemCode } : {}),
      })),
    }],
  };

  const result = await xeroApi("POST", "/Quotes", payload) as {
    Quotes: Array<{
      QuoteID: string;
      QuoteNumber: string;
      Status: string;
      Total: number;
    }>;
  };

  const created = result.Quotes[0];
  return {
    quoteId: created.QuoteID,
    quoteNumber: created.QuoteNumber,
    status: created.Status,
    total: created.Total,
  };
}

export async function xeroListQuotes(options?: {
  status?: string;
  contactName?: string;
  dateFrom?: string;
  dateTo?: string;
  expiryDateFrom?: string;
  expiryDateTo?: string;
  quoteNumber?: string;
}): Promise<unknown> {
  const params = new URLSearchParams();
  if (options?.status) params.set("Status", options.status);
  if (options?.contactName) params.set("ContactID", ""); // Xero Quotes API filters differ; contact filter is limited — leave to caller to filter
  if (options?.dateFrom) params.set("DateFrom", options.dateFrom);
  if (options?.dateTo) params.set("DateTo", options.dateTo);
  if (options?.expiryDateFrom) params.set("ExpiryDateFrom", options.expiryDateFrom);
  if (options?.expiryDateTo) params.set("ExpiryDateTo", options.expiryDateTo);
  if (options?.quoteNumber) params.set("QuoteNumber", options.quoteNumber);

  // Remove empty ContactID if we set it
  if (options?.contactName && !params.get("ContactID")) params.delete("ContactID");

  const qs = params.toString();
  const path = `/Quotes${qs ? `?${qs}` : ""}`;
  return xeroApi("GET", path);
}

export async function xeroUpdateQuote(update: {
  quoteId: string;
  status?: "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED" | "INVOICED";
  reference?: string;
  expiryDate?: string;
}): Promise<{ quoteId: string; status: string }> {
  const payload: Record<string, unknown> = { QuoteID: update.quoteId };
  if (update.status !== undefined) payload.Status = update.status;
  if (update.reference !== undefined) payload.Reference = update.reference;
  if (update.expiryDate !== undefined) payload.ExpiryDate = update.expiryDate;

  const result = await xeroApi("POST", "/Quotes", {
    Quotes: [payload],
  }) as { Quotes: Array<{ QuoteID: string; Status: string }> };
  return {
    quoteId: result.Quotes[0].QuoteID,
    status: result.Quotes[0].Status,
  };
}

// ─── Tracking Categories ─────────────────────────────────────────────────────

export async function xeroListTrackingCategories(): Promise<unknown> {
  return xeroApi("GET", "/TrackingCategories");
}

export async function xeroCreateTrackingCategory(category: {
  name: string;
  options?: string[];  // Optional initial options to create
}): Promise<{ trackingCategoryId: string; name: string; status: string }> {
  const result = await xeroApi("PUT", "/TrackingCategories", {
    Name: category.name,
  }) as {
    TrackingCategories: Array<{ TrackingCategoryID: string; Name: string; Status: string }>;
  };

  const created = result.TrackingCategories[0];

  // Add options if provided
  if (category.options && category.options.length > 0) {
    for (const optName of category.options) {
      await xeroApi("PUT", `/TrackingCategories/${created.TrackingCategoryID}/Options`, {
        Options: [{ Name: optName }],
      });
    }
  }

  return {
    trackingCategoryId: created.TrackingCategoryID,
    name: created.Name,
    status: created.Status,
  };
}

export async function xeroAddTrackingOption(
  trackingCategoryId: string,
  optionName: string
): Promise<{ trackingOptionId: string; name: string }> {
  const result = await xeroApi("PUT", `/TrackingCategories/${trackingCategoryId}/Options`, {
    Options: [{ Name: optionName }],
  }) as {
    Options: Array<{ TrackingOptionID: string; Name: string }>;
  };
  return {
    trackingOptionId: result.Options[0].TrackingOptionID,
    name: result.Options[0].Name,
  };
}

// ─── Contact Create / Update ─────────────────────────────────────────────────

export async function xeroCreateContact(contact: {
  name: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  abn?: string;        // Tax number (stored as TaxNumber in Xero)
  address?: {
    line1?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
  defaultPaymentTerms?: {
    days: number;
    type: "DAYSAFTERBILLDATE" | "DAYSAFTERBILLMONTH" | "OFCURRENTMONTH" | "OFFOLLOWINGMONTH";
  };
}): Promise<{ contactId: string; name: string; status: string }> {
  const payload: Record<string, unknown> = { Name: contact.name };
  if (contact.email) payload.EmailAddress = contact.email;
  if (contact.firstName) payload.FirstName = contact.firstName;
  if (contact.lastName) payload.LastName = contact.lastName;
  if (contact.abn) payload.TaxNumber = contact.abn;
  if (contact.phone) {
    payload.Phones = [{ PhoneType: "DEFAULT", PhoneNumber: contact.phone }];
  }
  if (contact.address) {
    payload.Addresses = [{
      AddressType: "POBOX",
      ...(contact.address.line1 ? { AddressLine1: contact.address.line1 } : {}),
      ...(contact.address.city ? { City: contact.address.city } : {}),
      ...(contact.address.region ? { Region: contact.address.region } : {}),
      ...(contact.address.postalCode ? { PostalCode: contact.address.postalCode } : {}),
      ...(contact.address.country ? { Country: contact.address.country } : {}),
    }];
  }
  if (contact.defaultPaymentTerms) {
    payload.PaymentTerms = {
      Bills: {
        Day: contact.defaultPaymentTerms.days,
        Type: contact.defaultPaymentTerms.type,
      },
    };
  }

  const result = await xeroApi("POST", "/Contacts", {
    Contacts: [payload],
  }) as { Contacts: Array<{ ContactID: string; Name: string; ContactStatus: string }> };

  const created = result.Contacts[0];
  return {
    contactId: created.ContactID,
    name: created.Name,
    status: created.ContactStatus,
  };
}

export async function xeroUpdateContact(update: {
  contactId: string;
  name?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  abn?: string;
  status?: "ACTIVE" | "ARCHIVED";
  defaultPaymentTerms?: {
    days: number;
    type: "DAYSAFTERBILLDATE" | "DAYSAFTERBILLMONTH" | "OFCURRENTMONTH" | "OFFOLLOWINGMONTH";
  };
}): Promise<{ contactId: string; name: string; status: string }> {
  const payload: Record<string, unknown> = { ContactID: update.contactId };
  if (update.name !== undefined) payload.Name = update.name;
  if (update.email !== undefined) payload.EmailAddress = update.email;
  if (update.firstName !== undefined) payload.FirstName = update.firstName;
  if (update.lastName !== undefined) payload.LastName = update.lastName;
  if (update.abn !== undefined) payload.TaxNumber = update.abn;
  if (update.status !== undefined) payload.ContactStatus = update.status;
  if (update.phone !== undefined) {
    payload.Phones = [{ PhoneType: "DEFAULT", PhoneNumber: update.phone }];
  }
  if (update.defaultPaymentTerms) {
    payload.PaymentTerms = {
      Bills: {
        Day: update.defaultPaymentTerms.days,
        Type: update.defaultPaymentTerms.type,
      },
    };
  }

  const result = await xeroApi("POST", "/Contacts", {
    Contacts: [payload],
  }) as { Contacts: Array<{ ContactID: string; Name: string; ContactStatus: string }> };

  const updated = result.Contacts[0];
  return {
    contactId: updated.ContactID,
    name: updated.Name,
    status: updated.ContactStatus,
  };
}

// ─── Bank Transactions, Transfers & Batch Payments ──────────────────────────

/**
 * Create a spend or receive money bank transaction. Use for direct bank
 * entries that aren't tied to an invoice or bill (e.g. bank fees,
 * interest received, owner drawings, cash sales).
 */
export async function xeroCreateBankTransaction(tx: {
  type: "SPEND" | "RECEIVE"; // SPEND = money out, RECEIVE = money in
  contactName: string;       // Payee or payer
  bankAccountName: string;   // Bank account name (must exist in Xero)
  date: string;              // ISO date
  reference?: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    accountCode?: string;    // Revenue/expense account to hit
    taxType?: string;
    itemCode?: string;
  }>;
  status?: "AUTHORISED" | "DELETED";
}): Promise<{
  bankTransactionId: string;
  status: string;
  total: number;
  type: string;
}> {
  // Look up bank account
  const accountsResult = await xeroApi("GET",
    `/Accounts?where=Name=="${encodeURIComponent(tx.bankAccountName)}"`
  ) as { Accounts?: Array<{ AccountID: string; Type: string }> };
  const bankAccount = accountsResult.Accounts?.[0];
  if (!bankAccount) throw new Error(`Bank account '${tx.bankAccountName}' not found in Xero.`);

  // Find or create contact
  const contactResult = await xeroApi("GET",
    `/Contacts?where=Name=="${encodeURIComponent(tx.contactName)}"`
  ) as { Contacts?: Array<{ ContactID: string }> };

  let contactId: string;
  if (contactResult.Contacts && contactResult.Contacts.length > 0) {
    contactId = contactResult.Contacts[0].ContactID;
  } else {
    const newContact = await xeroApi("POST", "/Contacts", {
      Contacts: [{ Name: tx.contactName }],
    }) as { Contacts: Array<{ ContactID: string }> };
    contactId = newContact.Contacts[0].ContactID;
  }

  const isSpend = tx.type === "SPEND";
  const defaultAccount = isSpend ? "310" : "200";
  const defaultTax = isSpend ? "INPUT" : "OUTPUT";

  const payload = {
    BankTransactions: [{
      Type: tx.type,
      Contact: { ContactID: contactId },
      BankAccount: { AccountID: bankAccount.AccountID },
      Date: tx.date,
      LineAmountTypes: "Exclusive",
      Status: tx.status || "AUTHORISED",
      ...(tx.reference ? { Reference: tx.reference } : {}),
      LineItems: tx.lineItems.map((li) => ({
        Description: li.description,
        Quantity: li.quantity,
        UnitAmount: li.unitAmount,
        AccountCode: li.accountCode || defaultAccount,
        TaxType: li.taxType || defaultTax,
        ...(li.itemCode ? { ItemCode: li.itemCode } : {}),
      })),
    }],
  };

  const result = await xeroApi("POST", "/BankTransactions", payload) as {
    BankTransactions: Array<{
      BankTransactionID: string;
      Status: string;
      Total: number;
      Type: string;
    }>;
  };

  const created = result.BankTransactions[0];
  return {
    bankTransactionId: created.BankTransactionID,
    status: created.Status,
    total: created.Total,
    type: created.Type,
  };
}

export async function xeroListBankTransactions(options?: {
  bankAccountName?: string;
  type?: "SPEND" | "RECEIVE";
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}): Promise<unknown> {
  let path = "/BankTransactions?page=1";
  const wheres: string[] = [];
  if (options?.type) wheres.push(`Type=="${options.type}"`);
  if (options?.status) wheres.push(`Status=="${options.status}"`);
  if (options?.bankAccountName) wheres.push(`BankAccount.Name=="${options.bankAccountName}"`);
  if (options?.dateFrom) wheres.push(`Date>=DateTime(${options.dateFrom.replace(/-/g, ",")})`);
  if (options?.dateTo) wheres.push(`Date<=DateTime(${options.dateTo.replace(/-/g, ",")})`);
  if (wheres.length > 0) path += `&where=${encodeURIComponent(wheres.join("&&"))}`;
  if (options?.limit) path += `&pageSize=${Math.min(options.limit, 100)}`;
  return xeroApi("GET", path);
}

/**
 * Record a transfer between two bank accounts.
 */
export async function xeroCreateBankTransfer(transfer: {
  fromAccountName: string;
  toAccountName: string;
  amount: number;
  date: string;
  reference?: string;
}): Promise<{ bankTransferId: string; amount: number; date: string }> {
  const accountsResult = await xeroApi("GET",
    `/Accounts?where=Type=="BANK"`
  ) as { Accounts?: Array<{ AccountID: string; Name: string }> };

  const accounts = accountsResult.Accounts || [];
  const from = accounts.find(a => a.Name === transfer.fromAccountName);
  const to = accounts.find(a => a.Name === transfer.toAccountName);
  if (!from) throw new Error(`From account '${transfer.fromAccountName}' not found.`);
  if (!to) throw new Error(`To account '${transfer.toAccountName}' not found.`);

  const result = await xeroApi("PUT", "/BankTransfers", {
    BankTransfers: [{
      FromBankAccount: { AccountID: from.AccountID },
      ToBankAccount: { AccountID: to.AccountID },
      Amount: transfer.amount,
      Date: transfer.date,
      ...(transfer.reference ? { Reference: transfer.reference } : {}),
    }],
  }) as {
    BankTransfers: Array<{ BankTransferID: string; Amount: number; Date: string }>;
  };

  const created = result.BankTransfers[0];
  return {
    bankTransferId: created.BankTransferID,
    amount: created.Amount,
    date: created.Date,
  };
}

/**
 * Create a batch payment: pay multiple authorised bills/invoices in one
 * go from a single bank account. Each payment targets an invoice and an
 * optional line-level reference.
 */
export async function xeroCreateBatchPayment(batch: {
  bankAccountName: string;
  date: string;
  reference?: string;
  narrative?: string;
  payments: Array<{
    invoiceId: string;
    amount: number;
    reference?: string;
  }>;
}): Promise<{
  batchPaymentId: string;
  status: string;
  totalAmount: number;
  paymentCount: number;
}> {
  const accountsResult = await xeroApi("GET",
    `/Accounts?where=Name=="${encodeURIComponent(batch.bankAccountName)}"`
  ) as { Accounts?: Array<{ AccountID: string; Type: string }> };
  const bankAccount = accountsResult.Accounts?.[0];
  if (!bankAccount) throw new Error(`Bank account '${batch.bankAccountName}' not found in Xero.`);

  const payload = {
    BatchPayments: [{
      Account: { AccountID: bankAccount.AccountID },
      Date: batch.date,
      ...(batch.reference ? { Reference: batch.reference } : {}),
      ...(batch.narrative ? { Narrative: batch.narrative } : {}),
      Payments: batch.payments.map((p) => ({
        Invoice: { InvoiceID: p.invoiceId },
        Amount: p.amount,
        ...(p.reference ? { Reference: p.reference } : {}),
      })),
    }],
  };

  const result = await xeroApi("PUT", "/BatchPayments", payload) as {
    BatchPayments: Array<{
      BatchPaymentID: string;
      Status: string;
      TotalAmount: number;
      Payments: unknown[];
    }>;
  };

  const created = result.BatchPayments[0];
  return {
    batchPaymentId: created.BatchPaymentID,
    status: created.Status,
    totalAmount: created.TotalAmount,
    paymentCount: created.Payments?.length || batch.payments.length,
  };
}

// ─── Bank Statements (reconciliation) ───────────────────────────────────────

/**
 * Fetch statement lines for a specific bank account over a date range.
 * Use for reconciliation workflows — ATHENA can pull the statement and
 * match against existing invoices/bills via xero_list_invoices.
 *
 * Note: This uses the standard Accounting API /BankTransactions endpoint
 * filtered by the bank account. For richer reconciliation status data
 * (matched/unmatched flags) Xero's separate Finance API is needed, which
 * requires different OAuth scopes.
 */
export async function xeroGetBankStatementLines(options: {
  bankAccountName: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;        // e.g. "AUTHORISED"
  limit?: number;
}): Promise<unknown> {
  // Look up the bank account
  const accountsResult = await xeroApi("GET",
    `/Accounts?where=Name=="${encodeURIComponent(options.bankAccountName)}"%26%26Type=="BANK"`
  ) as { Accounts?: Array<{ AccountID: string; Name: string; Code: string }> };

  const bankAccount = accountsResult.Accounts?.[0];
  if (!bankAccount) {
    throw new Error(`Bank account '${options.bankAccountName}' not found or not a BANK type.`);
  }

  // Fetch transactions filtered by that bank account
  let path = "/BankTransactions?page=1";
  const wheres: string[] = [`BankAccount.AccountID==Guid("${bankAccount.AccountID}")`];
  if (options.status) wheres.push(`Status=="${options.status}"`);
  if (options.dateFrom) wheres.push(`Date>=DateTime(${options.dateFrom.replace(/-/g, ",")})`);
  if (options.dateTo) wheres.push(`Date<=DateTime(${options.dateTo.replace(/-/g, ",")})`);
  path += `&where=${encodeURIComponent(wheres.join("&&"))}`;
  if (options.limit) path += `&pageSize=${Math.min(options.limit, 100)}`;

  const transactions = await xeroApi("GET", path);

  return {
    bankAccount: {
      accountId: bankAccount.AccountID,
      code: bankAccount.Code,
      name: bankAccount.Name,
    },
    ...(transactions as Record<string, unknown>),
  };
}

/**
 * Get the running balance for a bank account as of a specific date by
 * reading the Bank Summary report for that single account over the period.
 */
export async function xeroGetBankAccountBalance(options: {
  bankAccountName: string;
  date?: string;   // As-at date, ISO. Defaults to today.
}): Promise<unknown> {
  // Use the Bank Summary report which gives cash-in/out/balance per bank account
  const date = options.date || new Date().toISOString().split("T")[0];
  const report = await xeroApi("GET", `/Reports/BankSummary?fromDate=${date}&toDate=${date}`);
  return {
    bankAccountName: options.bankAccountName,
    date,
    report,
  };
}

// ─── History & Notes ─────────────────────────────────────────────────────────

type XeroHistoryEndpoint =
  | "Invoices"
  | "CreditNotes"
  | "BankTransactions"
  | "Contacts"
  | "PurchaseOrders"
  | "Quotes"
  | "ManualJournals"
  | "Payments"
  | "Receipts"
  | "ExpenseClaims"
  | "Overpayments"
  | "Prepayments";

/**
 * Read the history and notes trail for any Xero object. Returns a
 * chronological list of system events, user changes, and manually-added
 * notes. Useful for audit trails on invoices, bills, contacts, etc.
 */
export async function xeroGetHistory(
  endpoint: XeroHistoryEndpoint,
  objectId: string
): Promise<unknown> {
  return xeroApi("GET", `/${endpoint}/${objectId}/History`);
}

/**
 * Add a note to the history of a Xero object. Appears as a manual entry
 * in the object's history panel alongside system events.
 */
export async function xeroAddHistoryNote(
  endpoint: XeroHistoryEndpoint,
  objectId: string,
  details: string
): Promise<unknown> {
  return xeroApi("PUT", `/${endpoint}/${objectId}/History`, {
    HistoryRecords: [{
      Details: details,
    }],
  });
}

// ─── Generic Attachments ─────────────────────────────────────────────────────

type XeroAttachmentEndpoint =
  | "Invoices"
  | "CreditNotes"
  | "BankTransactions"
  | "Contacts"
  | "PurchaseOrders"
  | "Quotes"
  | "ManualJournals"
  | "Receipts";

/**
 * Attach a file to any Xero object by endpoint + ID. Generic version of
 * xeroAttachFileToInvoice — works for bills, contacts, quotes, etc.
 */
export async function xeroAttachFile(
  endpoint: XeroAttachmentEndpoint,
  objectId: string,
  fileName: string,
  fileBytes: Uint8Array,
  contentType = "application/pdf"
): Promise<{ attachmentId: string; fileName: string }> {
  const tokens = await getValidTokens();
  const url = `${XERO_API_BASE}/${endpoint}/${objectId}/Attachments/${encodeURIComponent(fileName)}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      "xero-tenant-id": tokens.tenantId,
      "Content-Type": contentType,
      "Content-Length": String(fileBytes.length),
    },
    body: Buffer.from(fileBytes),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero attachment upload failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { Attachments?: Array<{ AttachmentID: string; FileName: string }> };
  return {
    attachmentId: data.Attachments?.[0]?.AttachmentID || "",
    fileName: data.Attachments?.[0]?.FileName || fileName,
  };
}

/**
 * List all attachments on a Xero object.
 */
export async function xeroListAttachments(
  endpoint: XeroAttachmentEndpoint,
  objectId: string
): Promise<unknown> {
  return xeroApi("GET", `/${endpoint}/${objectId}/Attachments`);
}

// ─── Items / Inventory ────────────────────────────────────────────────────────

export async function xeroListItems(searchTerm?: string): Promise<unknown> {
  let path = "/Items?page=1&pageSize=50";
  if (searchTerm) {
    path += `&where=Name.Contains("${searchTerm}")`;
  }
  return xeroApi("GET", path);
}

export async function xeroGetItem(identifier: string): Promise<unknown> {
  return xeroApi("GET", `/Items/${encodeURIComponent(identifier)}`);
}
