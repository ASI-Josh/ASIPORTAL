/**
 * Xero MCP tool definitions + dispatcher.
 *
 * Extracted from src/app/api/mcp/route.ts so the Xero tool surface can
 * live on its own dedicated MCP endpoint (/api/xero-mcp). LEDGER and
 * Athena register /api/xero-mcp as a separate Claude connector,
 * leaving the main ASI Portal MCP free for the rest of the operation.
 *
 * xero_attach_job_report stays in here because it's Xero-outbound —
 * it just happens to also read Firestore for the job + PDF build.
 */

import {
  xeroCreateInvoice,
  xeroSendInvoice,
  xeroGetInvoice,
  xeroListContacts,
  xeroListInvoices,
  xeroGetConnectionStatus,
  xeroAttachFileToInvoice,
  xeroCreateBill,
  xeroUpdateInvoice,
  xeroVoidInvoice,
  xeroCreateCreditNote,
  xeroRecordPayment,
  xeroListAccounts,
  xeroCreateAccount,
  xeroUpdateAccount,
  xeroArchiveAccount,
  xeroCreateBankTransaction,
  xeroListBankTransactions,
  xeroCreateBankTransfer,
  xeroCreateBatchPayment,
  xeroGetReport,
  xeroCreateManualJournal,
  xeroCreateQuote,
  xeroListQuotes,
  xeroUpdateQuote,
  xeroListTrackingCategories,
  xeroCreateTrackingCategory,
  xeroAddTrackingOption,
  xeroCreateContact,
  xeroUpdateContact,
  xeroGetBankStatementLines,
  xeroGetBankAccountBalance,
  xeroGetHistory,
  xeroAddHistoryNote,
  xeroAttachFile,
  xeroListAttachments,
  xeroCreatePurchaseOrder,
  xeroSendPurchaseOrder,
  xeroGetPurchaseOrder,
  xeroListItems,
  xeroGetItem,
} from "@/lib/xero";

// ─── Tool type ────────────────────────────────────────────────────────────────

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const XERO_TOOLS: McpTool[] = [
  {
    name: "xero_status",
    description:
      "Check whether Xero is connected and authorised. Returns connection status, organisation name, token expiry, AND the list of scopes actually granted in the current token (grantedScopes) plus any scopes that are configured but missing from the token (missingScopes). Use this first when diagnosing 401s — if missingScopes is non-empty, the org owner needs to re-consent via /api/xero/auth.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "xero_create_invoice",
    description:
      "Create a DRAFT invoice in Xero. Returns the Xero invoice ID and number. The invoice is created as DRAFT — call xero_send_invoice to approve and email it to the client.",
    inputSchema: {
      type: "object",
      properties: {
        contactName: { type: "string", description: "Client/organisation name (must match or will be created in Xero)." },
        contactEmail: { type: "string", description: "Client email for invoice delivery." },
        reference: { type: "string", description: "ASI job number (e.g. 'MCK-26-0023') — appears as Reference on the invoice." },
        dueDate: { type: "string", description: "Invoice due date (ISO date, e.g. '2026-04-26')." },
        lineItems: {
          type: "array",
          description: "Invoice line items. Each: { description, quantity, unitAmount (ex-GST), accountCode (default '200'), taxType (default 'OUTPUT') }.",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unitAmount: { type: "number", description: "Amount per unit, ex-GST." },
              accountCode: { type: "string", description: "Xero account code (default '200' = Sales)." },
              taxType: { type: "string", description: "Xero tax type (default 'OUTPUT' = GST on Income)." },
            },
            required: ["description", "quantity", "unitAmount"],
          },
        },
        poNumber: { type: "string", description: "Client PO or works order number (optional)." },
      },
      required: ["contactName", "contactEmail", "reference", "dueDate", "lineItems"],
    },
  },
  {
    name: "xero_send_invoice",
    description:
      "Approve a DRAFT invoice and email it to the client. Moves the invoice from DRAFT → AUTHORISED, then sends via Xero's email system. If jobId is supplied, the Job Completion Report PDF is auto-attached to the invoice BEFORE it is sent, per ASI QA policy — every invoice ships with its traceability record.",
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: { type: "string", description: "The Xero InvoiceID (UUID) returned by xero_create_invoice." },
        jobId: { type: "string", description: "Optional ASI Portal job ID. When supplied, the completion report is generated and attached before the invoice is sent (QA requirement). The job must be completed or closed." },
      },
      required: ["invoiceId"],
    },
  },
  {
    name: "xero_get_invoice",
    description: "Get details of a Xero invoice by its InvoiceID.",
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: { type: "string", description: "The Xero InvoiceID (UUID)." },
      },
      required: ["invoiceId"],
    },
  },
  {
    name: "xero_list_contacts",
    description: "Search Xero contacts by name. Use this to find existing clients before creating invoices.",
    inputSchema: {
      type: "object",
      properties: {
        searchTerm: { type: "string", description: "Partial name match (e.g. 'McKenzie')." },
      },
    },
  },
  {
    name: "xero_attach_job_report",
    description:
      "Generate the Completed Job Report PDF for a job in ASI Portal and attach it to a Xero invoice. The job must be in 'completed' or 'closed' status. Call this AFTER the job is closed in ASI Portal so the report includes the invoice number.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "ASI Portal job Firestore document ID." },
        invoiceId: { type: "string", description: "Xero InvoiceID (UUID) to attach the report to." },
      },
      required: ["jobId", "invoiceId"],
    },
  },
  {
    name: "xero_create_purchase_order",
    description: "Create a DRAFT purchase order in Xero for a supplier. Line items should reference Xero item codes where possible.",
    inputSchema: {
      type: "object",
      properties: {
        contactName: { type: "string", description: "Supplier name (must match Xero contact or will be created)." },
        reference: { type: "string", description: "PO reference (e.g. 'PO-ASI-2026-001')." },
        deliveryDate: { type: "string", description: "Expected delivery date (ISO date)." },
        lineItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              itemCode: { type: "string", description: "Xero item code (from xero_list_items)." },
              description: { type: "string" },
              quantity: { type: "number" },
              unitAmount: { type: "number", description: "Cost per unit, ex-GST." },
              accountCode: { type: "string", description: "Xero account code (default '300' = Purchases)." },
            },
            required: ["description", "quantity", "unitAmount"],
          },
        },
      },
      required: ["contactName", "lineItems"],
    },
  },
  {
    name: "xero_send_purchase_order",
    description: "Approve a DRAFT purchase order and email it to the supplier.",
    inputSchema: {
      type: "object",
      properties: {
        purchaseOrderId: { type: "string", description: "Xero PurchaseOrderID (UUID)." },
      },
      required: ["purchaseOrderId"],
    },
  },
  {
    name: "xero_get_purchase_order",
    description: "Get details of a Xero purchase order by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        purchaseOrderId: { type: "string", description: "Xero PurchaseOrderID (UUID)." },
      },
      required: ["purchaseOrderId"],
    },
  },
  {
    name: "xero_list_items",
    description: "List products/items from Xero's inventory catalogue. Use to find item codes, cost prices, and supplier info for purchase orders.",
    inputSchema: {
      type: "object",
      properties: {
        searchTerm: { type: "string", description: "Partial name match (e.g. 'HydroGuard')." },
      },
    },
  },
  {
    name: "xero_get_item",
    description: "Get full details of a single Xero inventory item by code or ID.",
    inputSchema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Xero item code or ItemID." },
      },
      required: ["identifier"],
    },
  },
  {
    name: "xero_create_bill",
    description:
      "Create a supplier bill (accounts payable) in Xero. This is the AP counterpart to xero_create_invoice (AR). Optionally authorise and record payment in one call. Use for recording supplier invoices, goods received costs, and expense tracking.",
    inputSchema: {
      type: "object",
      properties: {
        contactName: { type: "string", description: "Supplier name (must match Xero contact or will be created)." },
        contactEmail: { type: "string", description: "Supplier email (optional, used if creating a new contact)." },
        reference: { type: "string", description: "Supplier invoice number (e.g. 'H1126356')." },
        date: { type: "string", description: "Bill date (ISO date, e.g. '2026-04-01')." },
        dueDate: { type: "string", description: "Due date (ISO date)." },
        lineItems: {
          type: "array",
          description: "Bill line items.",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unitAmount: { type: "number", description: "Cost per unit, ex-GST." },
              accountCode: { type: "string", description: "Xero account code (default '310' = Cost of Goods Sold)." },
              taxType: { type: "string", description: "Xero tax type (default 'INPUT' = GST on Expenses)." },
              itemCode: { type: "string", description: "Xero catalogue item code (optional)." },
            },
            required: ["description", "quantity", "unitAmount"],
          },
        },
        status: { type: "string", enum: ["DRAFT", "AUTHORISED"], description: "Bill status (default 'DRAFT'). Set to 'AUTHORISED' to approve immediately." },
        paidDate: { type: "string", description: "If provided, records a payment on this date (marks bill as PAID). Requires status 'AUTHORISED'." },
        paidAccount: { type: "string", description: "Payment account name in Xero (e.g. 'Mastercard', 'ANZ Business Account'). Required if paidDate is set." },
      },
      required: ["contactName", "reference", "date", "dueDate", "lineItems"],
    },
  },
  {
    name: "xero_list_invoices",
    description:
      "Search and list Xero invoices with filters. Use to find invoices by contact, status, date range, reference, or invoice number. Supports both AR (sales invoices) and AP (bills) via the 'type' filter. Replaces the need to search Gmail for invoice numbers.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status: DRAFT, SUBMITTED, AUTHORISED, PAID, VOIDED, DELETED." },
        type: { type: "string", enum: ["ACCREC", "ACCPAY"], description: "ACCREC = sales invoice (AR), ACCPAY = supplier bill (AP)." },
        contactName: { type: "string", description: "Partial contact name match (e.g. 'McKenzie')." },
        reference: { type: "string", description: "Partial match on the Reference field (e.g. job number 'MCK-26')." },
        invoiceNumber: { type: "string", description: "Exact invoice number match (e.g. 'INV-0253')." },
        dateFrom: { type: "string", description: "ISO date — invoices on/after this date." },
        dateTo: { type: "string", description: "ISO date — invoices on/before this date." },
        limit: { type: "number", description: "Max results (default 50, max 100)." },
      },
    },
  },
  {
    name: "xero_update_invoice",
    description:
      "Update an existing Xero invoice: amend line items, change reference/due date, or update status. Cannot modify PAID invoices — use a credit note instead. To void a DRAFT/SUBMITTED invoice, set status to 'VOIDED' or use xero_void_invoice.",
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: { type: "string", description: "Xero InvoiceID (UUID)." },
        reference: { type: "string", description: "New reference value (optional)." },
        dueDate: { type: "string", description: "New due date ISO (optional)." },
        status: { type: "string", enum: ["DRAFT", "SUBMITTED", "AUTHORISED", "VOIDED", "DELETED"], description: "New status (optional)." },
        lineItems: {
          type: "array",
          description: "Replacement line items. Include lineItemId on existing lines to update them; omit to add new lines. Omitting this field entirely leaves line items unchanged.",
          items: {
            type: "object",
            properties: {
              lineItemId: { type: "string", description: "Existing LineItemID to update (optional)." },
              description: { type: "string" },
              quantity: { type: "number" },
              unitAmount: { type: "number" },
              accountCode: { type: "string" },
              taxType: { type: "string" },
            },
            required: ["description", "quantity", "unitAmount"],
          },
        },
      },
      required: ["invoiceId"],
    },
  },
  {
    name: "xero_void_invoice",
    description:
      "Void a Xero invoice. Only works on DRAFT or SUBMITTED invoices, or AUTHORISED invoices with no payments. For invoices with payments or PAID status, create a credit note via xero_create_credit_note instead.",
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: { type: "string", description: "Xero InvoiceID (UUID) to void." },
      },
      required: ["invoiceId"],
    },
  },
  {
    name: "xero_create_credit_note",
    description:
      "Create a credit note in Xero. Use type 'ACCRECCREDIT' for customer refunds/adjustments on sales invoices, or 'ACCPAYCREDIT' for supplier credits on bills. Optionally allocate the full amount to an existing invoice in one call by setting allocateToInvoiceId (requires status 'AUTHORISED').",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["ACCRECCREDIT", "ACCPAYCREDIT"], description: "ACCRECCREDIT = customer credit (refund), ACCPAYCREDIT = supplier credit." },
        contactName: { type: "string", description: "Customer or supplier name." },
        reference: { type: "string", description: "Optional reference (e.g. 'Goodwill adjustment INV-0253')." },
        date: { type: "string", description: "Credit note date (ISO)." },
        lineItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unitAmount: { type: "number", description: "Amount ex-GST." },
              accountCode: { type: "string", description: "Default '200' for AR, '310' for AP." },
              taxType: { type: "string", description: "Default 'OUTPUT' for AR, 'INPUT' for AP." },
            },
            required: ["description", "quantity", "unitAmount"],
          },
        },
        status: { type: "string", enum: ["DRAFT", "AUTHORISED"], description: "Default 'DRAFT'. Must be 'AUTHORISED' to allocate to an invoice." },
        allocateToInvoiceId: { type: "string", description: "If set, allocates the full credit note amount to this invoice. Requires status 'AUTHORISED'." },
      },
      required: ["type", "contactName", "date", "lineItems"],
    },
  },
  {
    name: "xero_record_payment",
    description:
      "Record a payment against an existing Xero invoice or bill. Marks it as PAID (or partially paid) and creates a payment record against the specified bank/payment account. Use for reconciling payments received or supplier payments made.",
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: { type: "string", description: "Xero InvoiceID (UUID) of the invoice or bill being paid." },
        accountName: { type: "string", description: "Payment account name in Xero (e.g. 'Mastercard', 'ANZ Business Account')." },
        date: { type: "string", description: "Payment date (ISO)." },
        amount: { type: "number", description: "Payment amount (inc GST)." },
        reference: { type: "string", description: "Optional payment reference." },
      },
      required: ["invoiceId", "accountName", "date", "amount"],
    },
  },
  {
    name: "xero_list_accounts",
    description:
      "List accounts from the Xero chart of accounts. Filter by type (BANK, REVENUE, EXPENSE, CURRLIAB, etc.), status (ACTIVE/ARCHIVED), or partial name match. Use to verify account codes before creating invoices/bills, or find bank accounts for payments and transfers.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Account type filter: BANK, REVENUE, EXPENSE, CURRLIAB, CURRENT, FIXED, INVENTORY, etc." },
        status: { type: "string", enum: ["ACTIVE", "ARCHIVED"], description: "Filter by status." },
        name: { type: "string", description: "Partial name match (e.g. 'Mastercard')." },
      },
    },
  },
  {
    name: "xero_create_bank_transaction",
    description:
      "Create a SPEND (money out) or RECEIVE (money in) bank transaction directly against a bank account. Use for direct entries that aren't tied to an invoice/bill — e.g. bank fees, interest, cash sales, owner drawings, ad-hoc expenses. Status defaults to AUTHORISED.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["SPEND", "RECEIVE"], description: "SPEND = money out, RECEIVE = money in." },
        contactName: { type: "string", description: "Payee (for SPEND) or payer (for RECEIVE). Created in Xero if not found." },
        bankAccountName: { type: "string", description: "Bank account name (must exist in Xero)." },
        date: { type: "string", description: "Transaction date (ISO)." },
        reference: { type: "string", description: "Optional reference." },
        lineItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unitAmount: { type: "number", description: "Amount ex-GST." },
              accountCode: { type: "string", description: "Default '310' for SPEND, '200' for RECEIVE." },
              taxType: { type: "string", description: "Default 'INPUT' for SPEND, 'OUTPUT' for RECEIVE." },
              itemCode: { type: "string", description: "Optional Xero item code." },
            },
            required: ["description", "quantity", "unitAmount"],
          },
        },
        status: { type: "string", enum: ["AUTHORISED", "DELETED"], description: "Default 'AUTHORISED'." },
      },
      required: ["type", "contactName", "bankAccountName", "date", "lineItems"],
    },
  },
  {
    name: "xero_list_bank_transactions",
    description:
      "List bank transactions with filters. Use for bank reconciliation workflows — find all SPEND/RECEIVE entries on a specific bank account in a date range.",
    inputSchema: {
      type: "object",
      properties: {
        bankAccountName: { type: "string", description: "Filter by bank account name." },
        type: { type: "string", enum: ["SPEND", "RECEIVE"], description: "Filter by direction." },
        status: { type: "string", description: "Filter by status (AUTHORISED, DELETED, etc.)." },
        dateFrom: { type: "string", description: "ISO date — transactions on/after this date." },
        dateTo: { type: "string", description: "ISO date — transactions on/before this date." },
        limit: { type: "number", description: "Max results (default 50, max 100)." },
      },
    },
  },
  {
    name: "xero_create_bank_transfer",
    description:
      "Record a transfer between two bank accounts in Xero (e.g. moving funds from savings to operating, or owner contributions).",
    inputSchema: {
      type: "object",
      properties: {
        fromAccountName: { type: "string", description: "Source bank account name." },
        toAccountName: { type: "string", description: "Destination bank account name." },
        amount: { type: "number", description: "Transfer amount." },
        date: { type: "string", description: "Transfer date (ISO)." },
        reference: { type: "string", description: "Optional reference." },
      },
      required: ["fromAccountName", "toAccountName", "amount", "date"],
    },
  },
  {
    name: "xero_create_batch_payment",
    description:
      "Create a batch payment: pay multiple authorised bills or invoices in one go from a single bank account. Each payment targets a specific invoice by ID. Use for end-of-month supplier runs or bulk customer refunds.",
    inputSchema: {
      type: "object",
      properties: {
        bankAccountName: { type: "string", description: "Source bank account name." },
        date: { type: "string", description: "Payment date (ISO)." },
        reference: { type: "string", description: "Optional batch reference (e.g. 'March supplier run')." },
        narrative: { type: "string", description: "Optional narrative shown on the batch payment." },
        payments: {
          type: "array",
          description: "Array of individual payments, one per invoice/bill.",
          items: {
            type: "object",
            properties: {
              invoiceId: { type: "string", description: "Xero InvoiceID to pay." },
              amount: { type: "number", description: "Payment amount (inc GST)." },
              reference: { type: "string", description: "Optional per-payment reference." },
            },
            required: ["invoiceId", "amount"],
          },
        },
      },
      required: ["bankAccountName", "date", "payments"],
    },
  },
  {
    name: "xero_get_report",
    description:
      "Fetch a standard financial report from Xero. Use for automated P&L pulls, aged receivables/payables runs, BAS prep, balance sheet snapshots, etc. Dates are ISO (YYYY-MM-DD). Not all params apply to every report — Xero ignores unused ones. ATHENA should use this for weekly/monthly financial reporting.",
    inputSchema: {
      type: "object",
      properties: {
        reportType: {
          type: "string",
          enum: [
            "ProfitAndLoss",
            "BalanceSheet",
            "TrialBalance",
            "AgedReceivablesByContact",
            "AgedPayablesByContact",
            "BankSummary",
            "BudgetSummary",
            "ExecutiveSummary",
            "BASReport",
            "GSTReport",
            "TenNinetyNine",
          ],
          description: "Which report to pull.",
        },
        fromDate: { type: "string", description: "Period start date ISO (for P&L, BAS, etc.)." },
        toDate: { type: "string", description: "Period end date ISO." },
        date: { type: "string", description: "As-at date ISO (for Balance Sheet, Aged Receivables/Payables, Trial Balance)." },
        periods: { type: "number", description: "Number of comparison periods (1-12, for P&L and Balance Sheet)." },
        timeframe: { type: "string", enum: ["MONTH", "QUARTER", "YEAR"], description: "Comparison timeframe when using periods." },
        trackingCategoryId: { type: "string", description: "Optional tracking category filter." },
        trackingOptionId: { type: "string", description: "Optional tracking option filter." },
        standardLayout: { type: "boolean", description: "If true, use Xero's standard report layout instead of custom." },
        paymentsOnly: { type: "boolean", description: "If true, cash-basis report (for BAS/GST on cash basis)." },
      },
      required: ["reportType"],
    },
  },
  {
    name: "xero_create_account",
    description: "Create a new account in the Xero chart of accounts. Use for adding new expense/revenue categories, tracking buckets, or bank accounts.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Account code (e.g. '320')." },
        name: { type: "string", description: "Account name." },
        type: { type: "string", description: "Account type: REVENUE, EXPENSE, CURRLIAB, BANK, CURRENT, FIXED, INVENTORY, DIRECTCOSTS, etc." },
        description: { type: "string" },
        taxType: { type: "string", description: "Default tax type (e.g. 'OUTPUT', 'INPUT', 'NONE')." },
        enablePaymentsToAccount: { type: "boolean" },
        showInExpenseClaims: { type: "boolean" },
      },
      required: ["code", "name", "type"],
    },
  },
  {
    name: "xero_update_account",
    description: "Update an account in the Xero chart of accounts. Change code, name, description, tax type, or status.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "Xero AccountID (UUID)." },
        code: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        taxType: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "ARCHIVED"] },
      },
      required: ["accountId"],
    },
  },
  {
    name: "xero_archive_account",
    description: "Archive a Xero chart of accounts entry. Shortcut for xero_update_account with status=ARCHIVED.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "Xero AccountID to archive." },
      },
      required: ["accountId"],
    },
  },
  {
    name: "xero_create_manual_journal",
    description:
      "Create a manual journal entry for period-end adjustments, accruals, depreciation, or corrections. Use positive lineAmount for debits and negative for credits — they MUST sum to zero. Default status is DRAFT (review before posting).",
    inputSchema: {
      type: "object",
      properties: {
        narration: { type: "string", description: "Short description of the journal (e.g. 'March 2026 depreciation')." },
        date: { type: "string", description: "Journal date (ISO)." },
        status: { type: "string", enum: ["DRAFT", "POSTED"], description: "DRAFT (default, editable) or POSTED (locked)." },
        lineAmountTypes: { type: "string", enum: ["Exclusive", "Inclusive", "NoTax"], description: "Default 'NoTax' for most journals." },
        journalLines: {
          type: "array",
          description: "Journal lines. Positive = debit, negative = credit. Must balance to zero.",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              accountCode: { type: "string", description: "Xero account code this line posts to." },
              lineAmount: { type: "number", description: "Positive for debit, negative for credit." },
              taxType: { type: "string" },
              trackingCategoryName: { type: "string", description: "Optional tracking category name." },
              trackingOptionName: { type: "string", description: "Optional tracking option name (required if trackingCategoryName set)." },
            },
            required: ["accountCode", "lineAmount"],
          },
        },
      },
      required: ["narration", "date", "journalLines"],
    },
  },
  {
    name: "xero_create_quote",
    description:
      "Create a quote in Xero. Use for sales proposals that haven't been confirmed yet. Quotes can be converted to invoices once accepted. Default status DRAFT — set to SENT/ACCEPTED once the client responds.",
    inputSchema: {
      type: "object",
      properties: {
        contactName: { type: "string", description: "Client name (will be created in Xero if not found)." },
        contactEmail: { type: "string", description: "Client email (optional)." },
        date: { type: "string", description: "Quote date (ISO)." },
        expiryDate: { type: "string", description: "Quote expiry date (ISO)." },
        reference: { type: "string" },
        title: { type: "string", description: "Quote title (shown on the quote)." },
        summary: { type: "string", description: "Quote summary/intro text." },
        terms: { type: "string", description: "Terms and conditions text." },
        lineItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unitAmount: { type: "number" },
              accountCode: { type: "string", description: "Default '200'." },
              taxType: { type: "string", description: "Default 'OUTPUT'." },
              itemCode: { type: "string" },
            },
            required: ["description", "quantity", "unitAmount"],
          },
        },
        status: { type: "string", enum: ["DRAFT", "SENT", "ACCEPTED", "DECLINED"] },
      },
      required: ["contactName", "date", "lineItems"],
    },
  },
  {
    name: "xero_list_quotes",
    description: "Search and list Xero quotes with filters.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status (DRAFT, SENT, ACCEPTED, DECLINED, INVOICED)." },
        contactName: { type: "string" },
        dateFrom: { type: "string", description: "ISO date." },
        dateTo: { type: "string", description: "ISO date." },
        expiryDateFrom: { type: "string", description: "ISO date — quotes expiring on/after." },
        expiryDateTo: { type: "string", description: "ISO date — quotes expiring on/before." },
        quoteNumber: { type: "string" },
      },
    },
  },
  {
    name: "xero_update_quote",
    description: "Update a Xero quote — most commonly to change status (DRAFT → SENT → ACCEPTED), update reference, or extend expiry.",
    inputSchema: {
      type: "object",
      properties: {
        quoteId: { type: "string", description: "Xero QuoteID (UUID)." },
        status: { type: "string", enum: ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "INVOICED"] },
        reference: { type: "string" },
        expiryDate: { type: "string", description: "New expiry date (ISO)." },
      },
      required: ["quoteId"],
    },
  },
  {
    name: "xero_list_tracking_categories",
    description: "List all tracking categories and their options in Xero. Use to find tracking IDs for reporting segmentation (e.g. sector-level P&L).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "xero_create_tracking_category",
    description: "Create a new tracking category in Xero for cost-centre or departmental reporting (e.g. 'Sector', 'Region'). Optionally seed with initial options.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Category name (e.g. 'Sector')." },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Optional initial option names (e.g. ['Mass-Transit', 'Manufacturing', 'Retail']).",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "xero_add_tracking_option",
    description: "Add a new option to an existing tracking category.",
    inputSchema: {
      type: "object",
      properties: {
        trackingCategoryId: { type: "string", description: "Xero TrackingCategoryID." },
        optionName: { type: "string", description: "New option name to add." },
      },
      required: ["trackingCategoryId", "optionName"],
    },
  },
  {
    name: "xero_create_contact",
    description: "Create a new contact (customer or supplier) in Xero with full details including ABN, address, phone, and payment terms.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Contact name." },
        email: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        phone: { type: "string" },
        abn: { type: "string", description: "ABN / tax number." },
        address: {
          type: "object",
          properties: {
            line1: { type: "string" },
            city: { type: "string" },
            region: { type: "string" },
            postalCode: { type: "string" },
            country: { type: "string" },
          },
        },
        defaultPaymentTerms: {
          type: "object",
          properties: {
            days: { type: "number" },
            type: { type: "string", enum: ["DAYSAFTERBILLDATE", "DAYSAFTERBILLMONTH", "OFCURRENTMONTH", "OFFOLLOWINGMONTH"] },
          },
          required: ["days", "type"],
        },
      },
      required: ["name"],
    },
  },
  {
    name: "xero_update_contact",
    description:
      "Update an existing Xero contact: change name, email, address, phone, ABN, status (archive/activate), or payment terms. Use for keeping contact records in sync with the portal.",
    inputSchema: {
      type: "object",
      properties: {
        contactId: { type: "string", description: "Xero ContactID (UUID)." },
        name: { type: "string" },
        email: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        phone: { type: "string" },
        abn: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "ARCHIVED"] },
        defaultPaymentTerms: {
          type: "object",
          properties: {
            days: { type: "number" },
            type: { type: "string", enum: ["DAYSAFTERBILLDATE", "DAYSAFTERBILLMONTH", "OFCURRENTMONTH", "OFFOLLOWINGMONTH"] },
          },
          required: ["days", "type"],
        },
      },
      required: ["contactId"],
    },
  },
  {
    name: "xero_get_bank_statement_lines",
    description:
      "Fetch all transaction (statement) lines for a bank account over a date range. Use for bank reconciliation — ATHENA can pull the statement and match lines against existing invoices/bills. Reads from Xero's imported bank feed data.",
    inputSchema: {
      type: "object",
      properties: {
        bankAccountName: { type: "string", description: "Bank account name (must exist in Xero as a BANK type account)." },
        dateFrom: { type: "string", description: "ISO date — lines on/after this date." },
        dateTo: { type: "string", description: "ISO date — lines on/before this date." },
        status: { type: "string", description: "Filter by status (e.g. 'AUTHORISED')." },
        limit: { type: "number", description: "Max lines (default 50, max 100)." },
      },
      required: ["bankAccountName"],
    },
  },
  {
    name: "xero_get_bank_account_balance",
    description:
      "Get the running balance summary for a bank account as of a specific date. Returns Xero's Bank Summary report data for cash position verification.",
    inputSchema: {
      type: "object",
      properties: {
        bankAccountName: { type: "string" },
        date: { type: "string", description: "As-at date ISO. Defaults to today." },
      },
      required: ["bankAccountName"],
    },
  },
  {
    name: "xero_get_history",
    description:
      "Read the full history and notes trail for any Xero object (invoice, bill, contact, quote, etc.). Returns system events, user changes, and manually-added notes chronologically. Use for audit trails.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          enum: ["Invoices", "CreditNotes", "BankTransactions", "Contacts", "PurchaseOrders", "Quotes", "ManualJournals", "Payments", "Receipts", "ExpenseClaims", "Overpayments", "Prepayments"],
          description: "Which Xero object type.",
        },
        objectId: { type: "string", description: "Xero object ID (UUID)." },
      },
      required: ["endpoint", "objectId"],
    },
  },
  {
    name: "xero_add_history_note",
    description:
      "Add a manual note to the history of any Xero object. Shows up in the object's history panel as a user entry. Use to record context, decisions, or audit notes on invoices/bills/contacts.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          enum: ["Invoices", "CreditNotes", "BankTransactions", "Contacts", "PurchaseOrders", "Quotes", "ManualJournals", "Payments", "Receipts", "ExpenseClaims", "Overpayments", "Prepayments"],
          description: "Which Xero object type.",
        },
        objectId: { type: "string", description: "Xero object ID (UUID)." },
        details: { type: "string", description: "The note text to add." },
      },
      required: ["endpoint", "objectId", "details"],
    },
  },
  {
    name: "xero_attach_file",
    description:
      "Attach a file to any Xero object (invoice, bill, contact, quote, etc.). The file must be provided as base64-encoded content. Use for attaching supplier invoices to bills, contracts to contacts, supporting docs to journals.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          enum: ["Invoices", "CreditNotes", "BankTransactions", "Contacts", "PurchaseOrders", "Quotes", "ManualJournals", "Receipts"],
          description: "Which Xero object type.",
        },
        objectId: { type: "string", description: "Xero object ID (UUID)." },
        fileName: { type: "string", description: "File name (including extension)." },
        fileContentBase64: { type: "string", description: "File contents encoded as base64." },
        contentType: { type: "string", description: "MIME type (default 'application/pdf')." },
      },
      required: ["endpoint", "objectId", "fileName", "fileContentBase64"],
    },
  },
  {
    name: "xero_list_attachments",
    description: "List all attachments on a Xero object.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          enum: ["Invoices", "CreditNotes", "BankTransactions", "Contacts", "PurchaseOrders", "Quotes", "ManualJournals", "Receipts"],
        },
        objectId: { type: "string", description: "Xero object ID." },
      },
      required: ["endpoint", "objectId"],
    },
  },
];

// ─── Handler helpers ──────────────────────────────────────────────────────────

async function generateJobReportPdf(jobId: string): Promise<{ pdfBytes: Uint8Array; fileName: string }> {
  const { buildJobCompletionReport } = await import("@/lib/server/job-report-pdf");
  const { pdfBytes, fileName } = await buildJobCompletionReport(jobId, "LEDGER Agent");
  return { pdfBytes, fileName };
}

const VALID_HISTORY_ENDPOINTS = [
  "Invoices", "CreditNotes", "BankTransactions", "Contacts",
  "PurchaseOrders", "Quotes", "ManualJournals", "Payments",
  "Receipts", "ExpenseClaims", "Overpayments", "Prepayments",
] as const;

const VALID_ATTACHMENT_ENDPOINTS = [
  "Invoices", "CreditNotes", "BankTransactions", "Contacts",
  "PurchaseOrders", "Quotes", "ManualJournals", "Receipts",
] as const;

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function callXeroTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "xero_status":
      return xeroGetConnectionStatus();

    case "xero_create_invoice":
      return xeroCreateInvoice({
        contactName: String(args.contactName),
        contactEmail: String(args.contactEmail),
        reference: String(args.reference),
        dueDate: String(args.dueDate),
        lineItems: (args.lineItems as Array<{ description: string; quantity: number; unitAmount: number; accountCode?: string; taxType?: string }>) || [],
        poNumber: typeof args.poNumber === "string" ? args.poNumber : undefined,
      });

    case "xero_send_invoice": {
      const invoiceId = String(args.invoiceId);
      const jobId = typeof args.jobId === "string" && args.jobId.trim() ? args.jobId.trim() : null;
      let reportAttached = false;
      let attachError: string | null = null;
      if (jobId) {
        try {
          const { pdfBytes, fileName } = await generateJobReportPdf(jobId);
          await xeroAttachFileToInvoice(invoiceId, fileName, pdfBytes);
          reportAttached = true;
        } catch (err) {
          attachError = err instanceof Error ? err.message : String(err);
          console.error("[xero_send_invoice] Failed to auto-attach report:", err);
        }
      }
      const sendResult = await xeroSendInvoice(invoiceId);
      return { ...sendResult, reportAttached, attachError, jobId };
    }

    case "xero_get_invoice":
      return xeroGetInvoice(String(args.invoiceId));

    case "xero_list_contacts":
      return xeroListContacts(typeof args.searchTerm === "string" ? args.searchTerm : undefined);

    case "xero_attach_job_report": {
      const jobId = String(args.jobId);
      const invoiceId = String(args.invoiceId);
      const { pdfBytes, fileName } = await generateJobReportPdf(jobId);
      const result = await xeroAttachFileToInvoice(invoiceId, fileName, pdfBytes);
      return { ok: true, fileName, attachmentId: result.attachmentId, invoiceId };
    }

    case "xero_create_purchase_order":
      return xeroCreatePurchaseOrder({
        contactName: String(args.contactName),
        reference: typeof args.reference === "string" ? args.reference : undefined,
        deliveryDate: typeof args.deliveryDate === "string" ? args.deliveryDate : undefined,
        lineItems: (args.lineItems as Array<{ itemCode?: string; description: string; quantity: number; unitAmount: number; accountCode?: string }>) || [],
      });

    case "xero_send_purchase_order":
      return xeroSendPurchaseOrder(String(args.purchaseOrderId));

    case "xero_get_purchase_order":
      return xeroGetPurchaseOrder(String(args.purchaseOrderId));

    case "xero_list_items":
      return xeroListItems(typeof args.searchTerm === "string" ? args.searchTerm : undefined);

    case "xero_get_item":
      return xeroGetItem(String(args.identifier));

    case "xero_create_bill":
      return xeroCreateBill({
        contactName: String(args.contactName),
        contactEmail: typeof args.contactEmail === "string" ? args.contactEmail : undefined,
        reference: String(args.reference),
        date: String(args.date),
        dueDate: String(args.dueDate),
        lineItems: (args.lineItems as Array<{
          description: string; quantity: number; unitAmount: number;
          accountCode?: string; taxType?: string; itemCode?: string;
        }>) || [],
        status: args.status === "AUTHORISED" ? "AUTHORISED" : "DRAFT",
        paidDate: typeof args.paidDate === "string" ? args.paidDate : undefined,
        paidAccount: typeof args.paidAccount === "string" ? args.paidAccount : undefined,
      });

    case "xero_list_invoices":
      return xeroListInvoices({
        status: typeof args.status === "string" ? args.status : undefined,
        type: args.type === "ACCREC" || args.type === "ACCPAY" ? args.type : undefined,
        contactName: typeof args.contactName === "string" ? args.contactName : undefined,
        reference: typeof args.reference === "string" ? args.reference : undefined,
        invoiceNumber: typeof args.invoiceNumber === "string" ? args.invoiceNumber : undefined,
        dateFrom: typeof args.dateFrom === "string" ? args.dateFrom : undefined,
        dateTo: typeof args.dateTo === "string" ? args.dateTo : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });

    case "xero_update_invoice": {
      const status = args.status as string | undefined;
      return xeroUpdateInvoice({
        invoiceId: String(args.invoiceId),
        reference: typeof args.reference === "string" ? args.reference : undefined,
        dueDate: typeof args.dueDate === "string" ? args.dueDate : undefined,
        status: (status === "DRAFT" || status === "SUBMITTED" || status === "AUTHORISED" || status === "DELETED" || status === "VOIDED") ? status : undefined,
        lineItems: Array.isArray(args.lineItems) ? args.lineItems as Array<{
          lineItemId?: string;
          description: string;
          quantity: number;
          unitAmount: number;
          accountCode?: string;
          taxType?: string;
        }> : undefined,
      });
    }

    case "xero_void_invoice":
      return xeroVoidInvoice(String(args.invoiceId));

    case "xero_create_credit_note": {
      const type = args.type as string;
      if (type !== "ACCRECCREDIT" && type !== "ACCPAYCREDIT") {
        throw new Error("type must be 'ACCRECCREDIT' or 'ACCPAYCREDIT'.");
      }
      return xeroCreateCreditNote({
        type,
        contactName: String(args.contactName),
        reference: typeof args.reference === "string" ? args.reference : undefined,
        date: String(args.date),
        lineItems: (args.lineItems as Array<{
          description: string; quantity: number; unitAmount: number;
          accountCode?: string; taxType?: string;
        }>) || [],
        status: args.status === "AUTHORISED" ? "AUTHORISED" : "DRAFT",
        allocateToInvoiceId: typeof args.allocateToInvoiceId === "string" ? args.allocateToInvoiceId : undefined,
      });
    }

    case "xero_record_payment":
      return xeroRecordPayment({
        invoiceId: String(args.invoiceId),
        accountName: String(args.accountName),
        date: String(args.date),
        amount: Number(args.amount),
        reference: typeof args.reference === "string" ? args.reference : undefined,
      });

    case "xero_list_accounts":
      return xeroListAccounts({
        type: typeof args.type === "string" ? args.type : undefined,
        status: typeof args.status === "string" ? args.status : undefined,
        name: typeof args.name === "string" ? args.name : undefined,
      });

    case "xero_create_bank_transaction": {
      const type = args.type as string;
      if (type !== "SPEND" && type !== "RECEIVE") {
        throw new Error("type must be 'SPEND' or 'RECEIVE'.");
      }
      const status = args.status as string | undefined;
      return xeroCreateBankTransaction({
        type,
        contactName: String(args.contactName),
        bankAccountName: String(args.bankAccountName),
        date: String(args.date),
        reference: typeof args.reference === "string" ? args.reference : undefined,
        lineItems: (args.lineItems as Array<{
          description: string; quantity: number; unitAmount: number;
          accountCode?: string; taxType?: string; itemCode?: string;
        }>) || [],
        status: status === "DELETED" ? "DELETED" : "AUTHORISED",
      });
    }

    case "xero_list_bank_transactions":
      return xeroListBankTransactions({
        bankAccountName: typeof args.bankAccountName === "string" ? args.bankAccountName : undefined,
        type: args.type === "SPEND" || args.type === "RECEIVE" ? args.type : undefined,
        status: typeof args.status === "string" ? args.status : undefined,
        dateFrom: typeof args.dateFrom === "string" ? args.dateFrom : undefined,
        dateTo: typeof args.dateTo === "string" ? args.dateTo : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });

    case "xero_create_bank_transfer":
      return xeroCreateBankTransfer({
        fromAccountName: String(args.fromAccountName),
        toAccountName: String(args.toAccountName),
        amount: Number(args.amount),
        date: String(args.date),
        reference: typeof args.reference === "string" ? args.reference : undefined,
      });

    case "xero_create_batch_payment":
      return xeroCreateBatchPayment({
        bankAccountName: String(args.bankAccountName),
        date: String(args.date),
        reference: typeof args.reference === "string" ? args.reference : undefined,
        narrative: typeof args.narrative === "string" ? args.narrative : undefined,
        payments: (args.payments as Array<{
          invoiceId: string; amount: number; reference?: string;
        }>) || [],
      });

    case "xero_get_report": {
      const validReportTypes = [
        "ProfitAndLoss", "BalanceSheet", "TrialBalance",
        "AgedReceivablesByContact", "AgedPayablesByContact",
        "BankSummary", "BudgetSummary", "ExecutiveSummary",
        "BASReport", "GSTReport", "TenNinetyNine",
      ] as const;
      const reportType = args.reportType as string;
      if (!validReportTypes.includes(reportType as typeof validReportTypes[number])) {
        throw new Error(`Invalid reportType '${reportType}'. Must be one of: ${validReportTypes.join(", ")}.`);
      }
      const timeframe = args.timeframe as string | undefined;
      return xeroGetReport({
        reportType: reportType as typeof validReportTypes[number],
        fromDate: typeof args.fromDate === "string" ? args.fromDate : undefined,
        toDate: typeof args.toDate === "string" ? args.toDate : undefined,
        date: typeof args.date === "string" ? args.date : undefined,
        periods: typeof args.periods === "number" ? args.periods : undefined,
        timeframe: (timeframe === "MONTH" || timeframe === "QUARTER" || timeframe === "YEAR") ? timeframe : undefined,
        trackingCategoryId: typeof args.trackingCategoryId === "string" ? args.trackingCategoryId : undefined,
        trackingOptionId: typeof args.trackingOptionId === "string" ? args.trackingOptionId : undefined,
        standardLayout: typeof args.standardLayout === "boolean" ? args.standardLayout : undefined,
        paymentsOnly: typeof args.paymentsOnly === "boolean" ? args.paymentsOnly : undefined,
      });
    }

    case "xero_create_account":
      return xeroCreateAccount({
        code: String(args.code),
        name: String(args.name),
        type: String(args.type),
        description: typeof args.description === "string" ? args.description : undefined,
        taxType: typeof args.taxType === "string" ? args.taxType : undefined,
        enablePaymentsToAccount: typeof args.enablePaymentsToAccount === "boolean" ? args.enablePaymentsToAccount : undefined,
        showInExpenseClaims: typeof args.showInExpenseClaims === "boolean" ? args.showInExpenseClaims : undefined,
      });

    case "xero_update_account": {
      const status = args.status as string | undefined;
      return xeroUpdateAccount({
        accountId: String(args.accountId),
        code: typeof args.code === "string" ? args.code : undefined,
        name: typeof args.name === "string" ? args.name : undefined,
        description: typeof args.description === "string" ? args.description : undefined,
        taxType: typeof args.taxType === "string" ? args.taxType : undefined,
        status: status === "ACTIVE" || status === "ARCHIVED" ? status : undefined,
      });
    }

    case "xero_archive_account":
      return xeroArchiveAccount(String(args.accountId));

    case "xero_create_manual_journal": {
      const status = args.status as string | undefined;
      const lineAmountTypes = args.lineAmountTypes as string | undefined;
      return xeroCreateManualJournal({
        narration: String(args.narration),
        date: String(args.date),
        status: status === "POSTED" ? "POSTED" : "DRAFT",
        lineAmountTypes: (lineAmountTypes === "Exclusive" || lineAmountTypes === "Inclusive" || lineAmountTypes === "NoTax") ? lineAmountTypes : undefined,
        journalLines: (args.journalLines as Array<{
          description?: string; accountCode: string; lineAmount: number;
          taxType?: string; trackingCategoryName?: string; trackingOptionName?: string;
        }>) || [],
      });
    }

    case "xero_create_quote": {
      const status = args.status as string | undefined;
      return xeroCreateQuote({
        contactName: String(args.contactName),
        contactEmail: typeof args.contactEmail === "string" ? args.contactEmail : undefined,
        date: String(args.date),
        expiryDate: typeof args.expiryDate === "string" ? args.expiryDate : undefined,
        reference: typeof args.reference === "string" ? args.reference : undefined,
        title: typeof args.title === "string" ? args.title : undefined,
        summary: typeof args.summary === "string" ? args.summary : undefined,
        terms: typeof args.terms === "string" ? args.terms : undefined,
        lineItems: (args.lineItems as Array<{
          description: string; quantity: number; unitAmount: number;
          accountCode?: string; taxType?: string; itemCode?: string;
        }>) || [],
        status: (status === "DRAFT" || status === "SENT" || status === "ACCEPTED" || status === "DECLINED") ? status : undefined,
      });
    }

    case "xero_list_quotes":
      return xeroListQuotes({
        status: typeof args.status === "string" ? args.status : undefined,
        contactName: typeof args.contactName === "string" ? args.contactName : undefined,
        dateFrom: typeof args.dateFrom === "string" ? args.dateFrom : undefined,
        dateTo: typeof args.dateTo === "string" ? args.dateTo : undefined,
        expiryDateFrom: typeof args.expiryDateFrom === "string" ? args.expiryDateFrom : undefined,
        expiryDateTo: typeof args.expiryDateTo === "string" ? args.expiryDateTo : undefined,
        quoteNumber: typeof args.quoteNumber === "string" ? args.quoteNumber : undefined,
      });

    case "xero_update_quote": {
      const status = args.status as string | undefined;
      return xeroUpdateQuote({
        quoteId: String(args.quoteId),
        status: (status === "DRAFT" || status === "SENT" || status === "ACCEPTED" || status === "DECLINED" || status === "INVOICED") ? status : undefined,
        reference: typeof args.reference === "string" ? args.reference : undefined,
        expiryDate: typeof args.expiryDate === "string" ? args.expiryDate : undefined,
      });
    }

    case "xero_list_tracking_categories":
      return xeroListTrackingCategories();

    case "xero_create_tracking_category":
      return xeroCreateTrackingCategory({
        name: String(args.name),
        options: Array.isArray(args.options) ? args.options as string[] : undefined,
      });

    case "xero_add_tracking_option":
      return xeroAddTrackingOption(String(args.trackingCategoryId), String(args.optionName));

    case "xero_create_contact": {
      const address = args.address as Record<string, unknown> | undefined;
      const terms = args.defaultPaymentTerms as Record<string, unknown> | undefined;
      return xeroCreateContact({
        name: String(args.name),
        email: typeof args.email === "string" ? args.email : undefined,
        firstName: typeof args.firstName === "string" ? args.firstName : undefined,
        lastName: typeof args.lastName === "string" ? args.lastName : undefined,
        phone: typeof args.phone === "string" ? args.phone : undefined,
        abn: typeof args.abn === "string" ? args.abn : undefined,
        address: address ? {
          line1: typeof address.line1 === "string" ? address.line1 : undefined,
          city: typeof address.city === "string" ? address.city : undefined,
          region: typeof address.region === "string" ? address.region : undefined,
          postalCode: typeof address.postalCode === "string" ? address.postalCode : undefined,
          country: typeof address.country === "string" ? address.country : undefined,
        } : undefined,
        defaultPaymentTerms: terms && typeof terms.days === "number" && typeof terms.type === "string" ? {
          days: terms.days,
          type: terms.type as "DAYSAFTERBILLDATE" | "DAYSAFTERBILLMONTH" | "OFCURRENTMONTH" | "OFFOLLOWINGMONTH",
        } : undefined,
      });
    }

    case "xero_update_contact": {
      const status = args.status as string | undefined;
      const terms = args.defaultPaymentTerms as Record<string, unknown> | undefined;
      return xeroUpdateContact({
        contactId: String(args.contactId),
        name: typeof args.name === "string" ? args.name : undefined,
        email: typeof args.email === "string" ? args.email : undefined,
        firstName: typeof args.firstName === "string" ? args.firstName : undefined,
        lastName: typeof args.lastName === "string" ? args.lastName : undefined,
        phone: typeof args.phone === "string" ? args.phone : undefined,
        abn: typeof args.abn === "string" ? args.abn : undefined,
        status: status === "ACTIVE" || status === "ARCHIVED" ? status : undefined,
        defaultPaymentTerms: terms && typeof terms.days === "number" && typeof terms.type === "string" ? {
          days: terms.days,
          type: terms.type as "DAYSAFTERBILLDATE" | "DAYSAFTERBILLMONTH" | "OFCURRENTMONTH" | "OFFOLLOWINGMONTH",
        } : undefined,
      });
    }

    case "xero_get_bank_statement_lines":
      return xeroGetBankStatementLines({
        bankAccountName: String(args.bankAccountName),
        dateFrom: typeof args.dateFrom === "string" ? args.dateFrom : undefined,
        dateTo: typeof args.dateTo === "string" ? args.dateTo : undefined,
        status: typeof args.status === "string" ? args.status : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });

    case "xero_get_bank_account_balance":
      return xeroGetBankAccountBalance({
        bankAccountName: String(args.bankAccountName),
        date: typeof args.date === "string" ? args.date : undefined,
      });

    case "xero_get_history": {
      const endpoint = args.endpoint as string;
      if (!VALID_HISTORY_ENDPOINTS.includes(endpoint as typeof VALID_HISTORY_ENDPOINTS[number])) {
        throw new Error(`Invalid endpoint '${endpoint}'. Must be one of: ${VALID_HISTORY_ENDPOINTS.join(", ")}.`);
      }
      return xeroGetHistory(endpoint as typeof VALID_HISTORY_ENDPOINTS[number], String(args.objectId));
    }

    case "xero_add_history_note": {
      const endpoint = args.endpoint as string;
      if (!VALID_HISTORY_ENDPOINTS.includes(endpoint as typeof VALID_HISTORY_ENDPOINTS[number])) {
        throw new Error(`Invalid endpoint '${endpoint}'. Must be one of: ${VALID_HISTORY_ENDPOINTS.join(", ")}.`);
      }
      return xeroAddHistoryNote(
        endpoint as typeof VALID_HISTORY_ENDPOINTS[number],
        String(args.objectId),
        String(args.details)
      );
    }

    case "xero_attach_file": {
      const endpoint = args.endpoint as string;
      if (!VALID_ATTACHMENT_ENDPOINTS.includes(endpoint as typeof VALID_ATTACHMENT_ENDPOINTS[number])) {
        throw new Error(`Invalid endpoint '${endpoint}'. Must be one of: ${VALID_ATTACHMENT_ENDPOINTS.join(", ")}.`);
      }
      const base64 = String(args.fileContentBase64 || "");
      if (!base64) throw new Error("fileContentBase64 is required.");
      const fileBytes = new Uint8Array(Buffer.from(base64, "base64"));
      return xeroAttachFile(
        endpoint as typeof VALID_ATTACHMENT_ENDPOINTS[number],
        String(args.objectId),
        String(args.fileName),
        fileBytes,
        typeof args.contentType === "string" ? args.contentType : "application/pdf",
      );
    }

    case "xero_list_attachments": {
      const endpoint = args.endpoint as string;
      if (!VALID_ATTACHMENT_ENDPOINTS.includes(endpoint as typeof VALID_ATTACHMENT_ENDPOINTS[number])) {
        throw new Error(`Invalid endpoint '${endpoint}'. Must be one of: ${VALID_ATTACHMENT_ENDPOINTS.join(", ")}.`);
      }
      return xeroListAttachments(
        endpoint as typeof VALID_ATTACHMENT_ENDPOINTS[number],
        String(args.objectId),
      );
    }

    default:
      throw new Error(`Unknown Xero tool: ${name}`);
  }
}
