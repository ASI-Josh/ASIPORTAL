import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { ADMIN_EMAILS } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/collections";
import { admin } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const PAGE_SIZE: [number, number] = [595.28, 841.89]; // A4
const MARGIN = 36;
const TITLE_FONT_SIZE = 17;
const SECTION_TITLE_SIZE = 11;
const LABEL_FONT_SIZE = 9.6;
const BODY_FONT_SIZE = 10;
const BODY_LINE_HEIGHT = 12.6;
const REPAIR_TYPE_LABELS: Record<string, string> = {
  windscreen_crack_chip_repair: "Windscreen Crack/Chip Repair",
  windscreen_replacement: "Windscreen Replacement",
  scratch_graffiti_removal: "Scratch/Graffiti Removal",
  film_installation: "Film Installation",
  trim_restoration_interior: "Trim Restoration (Interior)",
  trim_restoration_exterior: "Trim Restoration (Exterior)",
  polymer_lens_restoration: "Polymer Lens Restoration",
};

type TimestampLike =
  | admin.firestore.Timestamp
  | { seconds: number; nanoseconds: number }
  | { toDate: () => Date }
  | Date
  | string
  | number
  | null
  | undefined;

type JobLineItem = {
  vehicleLabel: string;
  fleetAssetNumber: string;
  poWorksOrderNumber: string;
  repairType: string;
  location: string;
  description: string;
  status: string;
  labour: number;
  materials: number;
  total: number;
  prePhotos: string[];
  postPhotos: string[];
};

type JobPhotoItem = {
  url: string;
  label: string;
};

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toDate(value: TimestampLike): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value instanceof admin.firestore.Timestamp) return value.toDate();
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const maybe = value as { seconds?: unknown; nanoseconds?: unknown; toDate?: unknown };
  if (typeof maybe.toDate === "function") {
    const date = maybe.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (typeof maybe.seconds === "number" && typeof maybe.nanoseconds === "number") {
    return new admin.firestore.Timestamp(maybe.seconds, maybe.nanoseconds).toDate();
  }
  return null;
}

function formatDate(value: TimestampLike) {
  const date = toDate(value);
  if (!date) return "N/A";
  return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value: TimestampLike) {
  const date = toDate(value);
  if (!date) return "N/A";
  return date.toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value: number) {
  try {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function toSentenceCase(value: string) {
  if (!value) return "";
  const normalized = value.replace(/_/g, " ").trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function truncate(text: string, maxLength: number) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function wrapText(text: string, maxWidth: number, font: any, fontSize: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width <= maxWidth) {
      current = candidate;
      return;
    }
    if (current) lines.push(current);
    current = word;
  });
  if (current) lines.push(current);
  return lines;
}

function resolveRepairTypeLabel(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return REPAIR_TYPE_LABELS[trimmed] || trimmed.replace(/_/g, " ");
}

function resolveVehicleLabel(vehicle: Record<string, unknown>, index: number) {
  return (
    safeString(vehicle.registration) ||
    safeString(vehicle.fleetAssetNumber) ||
    safeString(vehicle.vin) ||
    `Vehicle ${index + 1}`
  );
}

function formatAddress(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const address = value as Record<string, unknown>;
  const parts = [
    safeString(address.street),
    safeString(address.suburb),
    safeString(address.state),
    safeString(address.postcode),
  ].filter(Boolean);
  return parts.join(" ");
}

function resolveServiceType(job: Record<string, any>) {
  const firstLine = safeString(job.notes).split(/\r?\n/).find((line) => line.trim().length > 0) || "";
  if (/^service\s*:/i.test(firstLine)) {
    return firstLine.replace(/^service\s*:\s*/i, "").trim();
  }
  return safeString(job.jobDescription) || "Not specified";
}

function resolveCompletedAt(job: Record<string, any>) {
  const completedDate = toDate(job.completedDate);
  if (completedDate) return completedDate;
  const statusLog = Array.isArray(job.statusLog) ? job.statusLog : [];
  const completedEntry = statusLog.find((entry: Record<string, any>) => safeString(entry.status) === "completed");
  return toDate(completedEntry?.changedAt);
}

function normalizePhotoList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

function extractJobReportData(job: Record<string, any>) {
  const vehicles = Array.isArray(job.jobVehicles) ? job.jobVehicles : [];
  const lineItems: JobLineItem[] = [];

  vehicles.forEach((vehicle: Record<string, any>, vehicleIndex: number) => {
    const vehicleLabel = resolveVehicleLabel(vehicle, vehicleIndex);
    const repairs = Array.isArray(vehicle.repairSites) ? vehicle.repairSites : [];

    repairs.forEach((repair: Record<string, any>) => {
      const labour = safeNumber(repair.labourCost);
      const materials = safeNumber(repair.materialsCost);
      const total = safeNumber(repair.totalCost) || labour + materials;
      const rawStatus =
        safeString(repair.workStatus) || (repair.isCompleted === true ? "completed" : "not_started");
      lineItems.push({
        vehicleLabel,
        fleetAssetNumber: safeString(vehicle.fleetAssetNumber),
        poWorksOrderNumber: safeString(vehicle.poWorksOrderNumber),
        repairType: resolveRepairTypeLabel(repair.repairType) || "-",
        location: safeString(repair.location) || "-",
        description: safeString(repair.description) || "-",
        status: toSentenceCase(rawStatus) || "-",
        labour,
        materials,
        total,
        prePhotos: normalizePhotoList(repair.preWorkPhotos),
        postPhotos: normalizePhotoList(repair.postWorkPhotos),
      });
    });
  });

  const computedTotals = lineItems.reduce(
    (acc, item) => ({
      labour: acc.labour + item.labour,
      materials: acc.materials + item.materials,
      total: acc.total + item.total,
    }),
    { labour: 0, materials: 0, total: 0 }
  );

  const totals = {
    labour: computedTotals.labour || safeNumber(job.totalLabourCost),
    materials: computedTotals.materials || safeNumber(job.totalMaterialsCost),
    total: computedTotals.total || safeNumber(job.totalJobCost),
  };

  const postPhotos: JobPhotoItem[] = [];
  const prePhotos: JobPhotoItem[] = [];
  const postSeen = new Set<string>();
  const preSeen = new Set<string>();

  lineItems.forEach((item) => {
    item.postPhotos.forEach((url) => {
      if (postSeen.has(url)) return;
      postSeen.add(url);
      postPhotos.push({ url, label: `${item.vehicleLabel} - ${item.repairType} (Post-work)` });
    });
    item.prePhotos.forEach((url) => {
      if (postSeen.has(url) || preSeen.has(url)) return;
      preSeen.add(url);
      prePhotos.push({ url, label: `${item.vehicleLabel} - ${item.repairType} (Pre-work)` });
    });
  });

  const photos = [...postPhotos.slice(0, 8), ...prePhotos.slice(0, 4)];

  return { vehicles, lineItems, totals, photos };
}

async function readAsiLogoBytes() {
  const filePath = path.join(process.cwd(), "public", "logos", "ASI BRANDING - OFFICIAL MAIN.png");
  return fs.readFile(filePath);
}

async function fetchImageBytes(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Image fetch failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

async function requireInternalUser(req: NextRequest): Promise<{
  userId: string;
  name: string;
  role: "admin" | "technician";
}> {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    throw new Error("Missing authorization token.");
  }
  const token = header.slice("Bearer ".length);
  const decoded = await admin.auth().verifyIdToken(token);
  const userId = decoded.uid;
  const email = decoded.email ? decoded.email.toLowerCase() : "";

  const userSnap = await admin.firestore().collection(COLLECTIONS.USERS).doc(userId).get();
  const user = (userSnap.data() as { role?: string; name?: string; email?: string } | undefined) || {};
  const role = safeString(user.role);
  const isAdmin = role === "admin" || (!!email && ADMIN_EMAILS.includes(email));
  const isTechnician = role === "technician";

  if (!isAdmin && !isTechnician) {
    throw new Error("Not authorised.");
  }

  return {
    userId,
    name: safeString(user.name) || safeString(user.email) || email || "ASI User",
    role: isAdmin ? "admin" : "technician",
  };
}

async function generateCompletionPdf(job: Record<string, any>, generatedBy: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let logoImage: any = null;
  try {
    const logoBytes = await readAsiLogoBytes();
    logoImage = await pdfDoc.embedPng(logoBytes);
  } catch {
    logoImage = null;
  }

  const { lineItems, totals, photos } = extractJobReportData(job);
  const completedAt = resolveCompletedAt(job);
  const scheduled = `${formatDate(job.scheduledDate)} ${safeString(job.booking?.preferredTime)}`.trim();
  const serviceType = resolveServiceType(job);
  const siteName = safeString(job.siteLocation?.name);
  const siteAddress = formatAddress(job.siteLocation?.address) || safeString(job.siteLocation?.address);
  const team = Array.isArray(job.assignedTechnicians) ? job.assignedTechnicians : [];
  const notesText = safeString(job.notes);
  const jobDescription = safeString(job.jobDescription);
  const riskAssessment = job.riskAssessment as Record<string, any> | undefined;
  const riskCompletedAt = toDate(riskAssessment?.completedAt);
  const riskCompletedBy = safeString(riskAssessment?.completedBy?.name);
  const hazardCount = Array.isArray(riskAssessment?.hazards)
    ? riskAssessment!.hazards.filter((hazard: Record<string, any>) => hazard.present === true).length
    : 0;

  let page = pdfDoc.addPage(PAGE_SIZE);
  const [width, height] = PAGE_SIZE;
  let cursorY = height - MARGIN;
  let pageNumber = 1;
  const generatedAtText = formatDateTime(new Date());
  const safeJobNumber = safeString(job.jobNumber) || safeString(job.id) || "JOB";

  const drawHeader = () => {
    const topY = height - MARGIN;
    const logoDims = logoImage ? logoImage.scale(0.14) : null;
    const titleX = logoDims ? MARGIN + logoDims.width + 12 : MARGIN;
    if (logoDims) {
      page.drawImage(logoImage, {
        x: MARGIN,
        y: topY - logoDims.height,
        width: logoDims.width,
        height: logoDims.height,
      });
    }

    page.drawText("Job Completion Report", {
      x: titleX,
      y: topY - 16,
      size: TITLE_FONT_SIZE,
      font: bold,
      color: rgb(0.08, 0.08, 0.1),
    });
    page.drawText(`Job ref: ${safeJobNumber} | Generated: ${generatedAtText}`, {
      x: titleX,
      y: topY - 33,
      size: LABEL_FONT_SIZE,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    page.drawText(`Prepared by: ${generatedBy}`, {
      x: titleX,
      y: topY - 46,
      size: LABEL_FONT_SIZE,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    page.drawText(`Page ${pageNumber}`, {
      x: width - MARGIN - 40,
      y: MARGIN - 12,
      size: 8.5,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    page.drawText("Controlled record. Uncontrolled if printed.", {
      x: MARGIN,
      y: MARGIN - 12,
      size: 8.5,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });

    cursorY = topY - Math.max(logoDims?.height ?? 0, 52) - 12;
  };

  const addPage = () => {
    page = pdfDoc.addPage(PAGE_SIZE);
    pageNumber += 1;
    drawHeader();
  };

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY - requiredHeight < MARGIN + 8) addPage();
  };

  const drawSectionTitle = (title: string) => {
    ensureSpace(30);
    page.drawRectangle({
      x: MARGIN,
      y: cursorY - 20,
      width: width - MARGIN * 2,
      height: 20,
      color: rgb(0.94, 0.96, 0.99),
      borderColor: rgb(0.82, 0.86, 0.92),
      borderWidth: 1,
    });
    page.drawText(title, {
      x: MARGIN + 8,
      y: cursorY - 14,
      size: SECTION_TITLE_SIZE,
      font: bold,
      color: rgb(0.14, 0.16, 0.2),
    });
    cursorY -= 28;
  };

  const drawLabelValue = (label: string, value: string) => {
    const labelWidth = 126;
    const displayValue = value.trim() || "-";
    const wrapped = wrapText(displayValue, width - MARGIN * 2 - labelWidth - 4, font, BODY_FONT_SIZE);
    ensureSpace(10 + wrapped.length * BODY_LINE_HEIGHT + 2);
    page.drawText(`${label}:`, {
      x: MARGIN,
      y: cursorY,
      size: LABEL_FONT_SIZE,
      font: bold,
      color: rgb(0.18, 0.18, 0.2),
    });
    wrapped.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: MARGIN + labelWidth,
        y: cursorY - lineIndex * BODY_LINE_HEIGHT,
        size: BODY_FONT_SIZE,
        font,
        color: rgb(0.14, 0.14, 0.16),
      });
    });
    cursorY -= Math.max(15, wrapped.length * BODY_LINE_HEIGHT + 3);
  };

  const drawBullet = (value: string) => {
    const wrapped = wrapText(value, width - MARGIN * 2 - 16, font, BODY_FONT_SIZE);
    ensureSpace(wrapped.length * BODY_LINE_HEIGHT + 4);
    wrapped.forEach((line, idx) => {
      page.drawText(idx === 0 ? `- ${line}` : `  ${line}`, {
        x: MARGIN + 2,
        y: cursorY,
        size: BODY_FONT_SIZE,
        font,
        color: rgb(0.14, 0.14, 0.16),
      });
      cursorY -= BODY_LINE_HEIGHT;
    });
    cursorY -= 2;
  };

  const drawParagraph = (value: string) => {
    const wrapped = wrapText(value, width - MARGIN * 2, font, BODY_FONT_SIZE);
    ensureSpace(wrapped.length * BODY_LINE_HEIGHT + 4);
    wrapped.forEach((line) => {
      page.drawText(line, {
        x: MARGIN,
        y: cursorY,
        size: BODY_FONT_SIZE,
        font,
        color: rgb(0.14, 0.14, 0.16),
      });
      cursorY -= BODY_LINE_HEIGHT;
    });
    cursorY -= 2;
  };

  drawHeader();

  drawSectionTitle("1. Job Overview");
  drawLabelValue("Job Number", safeJobNumber);
  drawLabelValue("Status", toSentenceCase(safeString(job.status)) || "-");
  drawLabelValue("Service Type", serviceType);
  drawLabelValue("Client", safeString(job.clientName));
  drawLabelValue("Client Email", safeString(job.clientEmail));
  drawLabelValue("Client Phone", safeString(job.clientPhone) || "-");
  drawLabelValue("Site", [siteName, siteAddress].filter(Boolean).join(" - "));
  drawLabelValue("Scheduled", scheduled);
  drawLabelValue("Completed", completedAt ? formatDateTime(completedAt) : "N/A");
  drawLabelValue("Invoice Number", safeString(job.invoiceNumber) || "-");
  drawLabelValue("Invoice Date", formatDate(job.invoiceDate));
  drawLabelValue("Invoice Sent", formatDate(job.invoiceSentAt));

  drawSectionTitle("2. Assigned Team");
  if (team.length === 0) {
    drawBullet("No assigned team recorded on this job.");
  } else {
    team.forEach((assignment: Record<string, any>) => {
      const technicianName = safeString(assignment.technicianName) || safeString(assignment.technicianId) || "-";
      const roleLabel = toSentenceCase(safeString(assignment.role) || "secondary");
      drawBullet(`${technicianName} (${roleLabel})`);
    });
  }

  drawSectionTitle("3. Vehicle and Repair Details");
  if (lineItems.length === 0) {
    drawBullet("No repair sites were captured on this job.");
  } else {
    let lastVehicle = "";
    lineItems.forEach((item) => {
      if (item.vehicleLabel !== lastVehicle) {
        lastVehicle = item.vehicleLabel;
        ensureSpace(36);
        page.drawText(`Vehicle: ${item.vehicleLabel}`, {
          x: MARGIN,
          y: cursorY,
          size: 11,
          font: bold,
          color: rgb(0.12, 0.12, 0.15),
        });
        cursorY -= 14;
        const vehicleMeta = [
          item.fleetAssetNumber ? `Fleet/Asset: ${item.fleetAssetNumber}` : "",
          item.poWorksOrderNumber ? `PO/WO: ${item.poWorksOrderNumber}` : "",
        ]
          .filter(Boolean)
          .join(" | ");
        if (vehicleMeta) {
          page.drawText(vehicleMeta, {
            x: MARGIN,
            y: cursorY,
            size: LABEL_FONT_SIZE,
            font,
            color: rgb(0.35, 0.35, 0.4),
          });
          cursorY -= 12;
        }
      }

      drawBullet(`${item.repairType} - ${item.location}`);
      drawBullet(
        `Status: ${item.status} | Labour: ${formatCurrency(item.labour)} | Materials: ${formatCurrency(
          item.materials
        )} | Total: ${formatCurrency(item.total)}`
      );
      if (item.description !== "-") {
        drawBullet(`Notes: ${item.description}`);
      }
      ensureSpace(8);
      page.drawLine({
        start: { x: MARGIN + 6, y: cursorY },
        end: { x: width - MARGIN - 6, y: cursorY },
        thickness: 0.5,
        color: rgb(0.87, 0.89, 0.92),
      });
      cursorY -= 7;
    });
  }

  drawSectionTitle("4. Cost Summary");
  drawLabelValue("Total Labour", formatCurrency(totals.labour));
  drawLabelValue("Total Materials", formatCurrency(totals.materials));
  drawLabelValue("Grand Total", formatCurrency(totals.total));
  drawLabelValue("Repair Line Items", String(lineItems.length));

  drawSectionTitle("5. Site HSE Risk Assessment");
  drawLabelValue("Assessment Status", riskCompletedAt ? "Completed" : "Not completed");
  drawLabelValue("Completed By", riskCompletedBy || "-");
  drawLabelValue("Completed At", riskCompletedAt ? formatDateTime(riskCompletedAt) : "N/A");
  drawLabelValue("Present Hazards Captured", String(hazardCount));
  drawLabelValue("Supervisor Notified", riskAssessment?.supervisorNotified ? "Yes" : "No");
  drawLabelValue(
    "Stop-Work Authority Confirmed",
    riskAssessment?.stopWorkAuthorityConfirmed ? "Yes" : "No"
  );

  drawSectionTitle("6. Notes");
  const notesForReport = [jobDescription, notesText].filter(Boolean).join("\n\n");
  if (!notesForReport) {
    drawBullet("No additional notes were recorded.");
  } else {
    const noteParagraphs = notesForReport
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    noteParagraphs.forEach((paragraph) => {
      drawParagraph(paragraph);
    });
  }

  if (photos.length > 0) {
    addPage();
    drawSectionTitle("7. Work Photos (Post-work first)");

    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      const imageBoxHeight = 110;
      const requiredHeight = imageBoxHeight + 28;
      ensureSpace(requiredHeight);

      page.drawText(`${index + 1}. ${truncate(photo.label, 95)}`, {
        x: MARGIN,
        y: cursorY,
        size: LABEL_FONT_SIZE,
        font: bold,
        color: rgb(0.15, 0.15, 0.18),
      });
      cursorY -= 14;

      const boxX = MARGIN;
      const boxY = cursorY - imageBoxHeight;
      const boxW = width - MARGIN * 2;
      const boxH = imageBoxHeight;
      page.drawRectangle({
        x: boxX,
        y: boxY,
        width: boxW,
        height: boxH,
        borderColor: rgb(0.82, 0.84, 0.88),
        borderWidth: 1,
        color: rgb(0.98, 0.98, 0.99),
      });

      try {
        const bytes = await fetchImageBytes(photo.url);
        let image: any = null;
        try {
          image = await pdfDoc.embedJpg(bytes);
        } catch {
          image = await pdfDoc.embedPng(bytes);
        }
        const scaled = image.scale(Math.min((boxW - 4) / image.width, (boxH - 4) / image.height));
        page.drawImage(image, {
          x: boxX + (boxW - scaled.width) / 2,
          y: boxY + (boxH - scaled.height) / 2,
          width: scaled.width,
          height: scaled.height,
        });
      } catch {
        page.drawText("Image unavailable", {
          x: boxX + 10,
          y: boxY + boxH / 2 - 5,
          size: 9,
          font,
          color: rgb(0.45, 0.45, 0.5),
        });
      }

      cursorY = boxY - 10;
    }
  }

  return pdfDoc.save();
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireInternalUser(req);
    const payload = (await req.json().catch(() => ({}))) as { jobId?: string };
    const jobId = safeString(payload.jobId);
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    }

    const jobRef = admin.firestore().collection(COLLECTIONS.JOBS).doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const job = (jobSnap.data() || {}) as Record<string, any>;
    const status = safeString(job.status);
    if (status !== "completed" && status !== "closed") {
      return NextResponse.json(
        { error: "Completion report is only available once the job is completed or closed." },
        { status: 400 }
      );
    }

    const pdfBytes = await generateCompletionPdf(job, actor.name);
    const safeJobNumber = (safeString(job.jobNumber) || jobId).replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileName = `${safeJobNumber}_Completion_Report.pdf`;

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate completion report.";
    console.error("Job completion report API failed:", error);
    const normalized = message.toLowerCase();
    if (normalized.includes("missing authorization token")) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    if (normalized.includes("not authorised")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
