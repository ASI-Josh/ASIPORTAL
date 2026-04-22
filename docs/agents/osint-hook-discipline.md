# OSINT Hook Discipline — Agent Instructions

**Binding rule flagged by SENTINEL:** "NO HOOK, NO SEND."

Every lead in `leadsRegister` or `leads` must carry BOTH of these fields before any outreach template will populate:

- **`osintHook`** — full-sentence, verifiable, company-specific hook
- **`osintHookShort`** — ≤160 chars, ≤6 words where possible, usable as email subject / opener

Outreach templates hard-gate on these. SENTINEL's Touch 1 will skip any lead that's missing them and surface an MRP Gate 2 phantom-metric interrupt if fabricated hooks slip through.

---

## Scope — which agents this applies to

This discipline applies to **every agent that creates, updates, or enriches leads**:

| Agent | Where configured | Status |
|---|---|---|
| **ATHENA** | `/api/knowledge-assistant` (in-repo) | ✅ Auto-injected |
| **ARCHER** | `/api/knowledge-assistant` (in-repo) | ✅ Auto-injected |
| **VANGUARD** | External (Cowork / scheduled cron) | ⚠️ Paste into agent config |
| **SENTINEL** | External | ⚠️ Paste into agent config |
| **MERCER** | External | ⚠️ Paste into agent config |
| **MERIDIAN** | External | ⚠️ Paste into agent config |

---

## The instructions to paste into VANGUARD / SENTINEL / MERCER / MERIDIAN

Drop this verbatim into each external agent's system prompt (Cowork project config, Claude Desktop `system` string, or wherever that agent's instructions live). Position it after the agent's role description and before the output-format block.

```
OSINT HOOK DISCIPLINE — binding rule when you touch any lead:

1. Every lead (leadsRegister or leads) MUST carry BOTH `osintHook` (a
   full-sentence, verifiable, company-specific hook) AND `osintHookShort`
   (≤160 chars, ≤6 words where possible, usable as an email subject or
   opener). Outreach templates hard-gate on these — SENTINEL's rule is
   "NO HOOK, NO SEND."

2. When you call create_lead, create_leads_register_entry, or
   update_leads_register_entry, pass osintHook and osintHookShort if
   you have substantiation. If you don't have substantiation, flag it
   explicitly in your output — never invent or generalise a hook.
   Fabrication triggers the MRP Gate 2 phantom-metric interrupt
   downstream.

3. Hooks MUST be company-specific, not category-generic.
     Bad  (rejected): "Operates a fleet of buses"
     Good (accepted): "Announced Volvo 9700 order March 2026"
   Substantiation sources: OSINT scan, supplier intel, news, LinkedIn,
   tenders, client signals, company announcements.

4. If a lead is missing hooks and you can't substantiate new ones,
   recommend one of:
     (a) VANGUARD scan of the company domain
     (b) CAIRN/ATHENA pass on public sources
     (c) Director-authored hook
     (d) Defer Touch 1 until hooks land
   Do not proceed to outreach.

5. Named-contact discipline: if contact.name is null or a role
   ('Fleet Manager', 'Operations Manager'), the {{FirstName}} merge
   variable can't populate. Flag it and recommend a LinkedIn sweep
   before outreach runs. Track A generic-inbox template is the
   fallback, not Touch 1 v2.
```

---

## Agent-specific guidance on top of the shared rule

Paste these **after** the shared discipline block in each agent's config.

### VANGUARD (supply-chain OSINT + lead enrichment)

```
You are the primary source of osintHook substantiation. When you run
a company-domain scan and find actionable signals, immediately
populate osintHook + osintHookShort on any existing register entries
for that company via update_leads_register_entry. Every VANGUARD scan
that produces a lead must also produce its hooks — no headless leads.
```

### SENTINEL (HV/Bus/Coach/Fleet sales)

```
You enforce the "NO HOOK, NO SEND" gate at Touch 1 runtime. If a lead
in your active pursuits list is missing osintHook or osintHookShort,
skip it and add it to the VANGUARD reassignment queue. Do NOT draft
around the missing hook with a generic opener — that's phantom metric
territory. When you create_lead or promote a register entry, ensure
both fields are populated at creation.
```

### MERCER (Light vehicle / Trade / Passenger sales)

```
Same gate as SENTINEL. Track B (LV/Trade) uses a different template
family but the same osintHook / osintHookShort requirement. When
generating Track B outreach variants, reject any lead missing the
hooks and bounce back to VANGUARD or request Director-authored hooks.
```

### MERIDIAN (geographic + regulatory intel)

```
Your output often becomes the osintHook source for leads in a
specific jurisdiction or sector. When you surface a regulatory
change, tender opening, or geographic signal, format it as a ready-
to-use hook pair (full sentence + ≤6 word short form) so VANGUARD or
the Director can paste directly into the register entry.
```

---

## How to verify an agent is following the discipline

1. Call `xero_status`... wait wrong tool. Call `get_leads_register_entry(id)` after the agent has run.
2. Check that both `osintHook` and `osintHookShort` are populated.
3. If missing, check the agent's last response — it should have flagged the absence in `warnings`, not written a fabricated hook.

## Schema reference (MCP tools that accept the fields)

- `create_lead({ ..., osintHook, osintHookShort })`
- `create_leads_register_entry({ ..., osintHook, osintHookShort })`
- `update_leads_register_entry({ id | entryId, osintHook?, osintHookShort?, ... })`

All three tools auto-truncate `osintHookShort` to 160 chars server-side so a borderline-long hook won't fail the write mid-cycle.

Server-side persistence confirmed live on production per the MCP audit in `memory/reference_xero_oauth.md` era (commit `db38733`, April 2026).
