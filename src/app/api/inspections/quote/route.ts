import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { admin } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import { getPublicEnv } from "@/lib/public-env";

export const runtime = "nodejs";

const REPAIR_TYPE_LABELS: Record<string, string> = {
  windscreen_crack_chip_repair: "Windscreen Crack/Chip Repair",
  windscreen_replacement: "Windscreen Replacement",
  scratch_graffiti_removal: "Scratch/Graffiti Removal",
  film_installation: "Film Installation",
  trim_restoration_interior: "Trim Restoration (Interior)",
  trim_restoration_exterior: "Trim Restoration (Exterior)",
  polymer_lens_restoration: "Polymer Lens Restoration",
};
const DEFAULT_APP_URL = "https://asiportal.live";

type TimestampLike =
  | admin.firestore.Timestamp
  | { seconds: number; nanoseconds: number }
  | { toDate: () => Date }
  | Date
  | string
  | number
  | null
  | undefined;

type InspectionQuoteFile = {
  fileName: string;
  storagePath: string;
  downloadUrl: string;
  contentType: "application/pdf";
  size: number;
};

type GenerateResult = {
  file: InspectionQuoteFile;
};

const buildDownloadUrl = (bucketName: string, filePath: string, token: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
    filePath
  )}?alt=media&token=${token}`;

function normalizeAppUrl(value: string) {
  return value.trim().replace(/\.+$/, "").replace(/\/+$/, "");
}

function resolveAppUrl(req: NextRequest) {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return normalizeAppUrl(configured);

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || (host?.includes("localhost") ? "http" : "https");
  if (host) return `${proto}://${host}`;

  return DEFAULT_APP_URL;
}

function toDate(value: TimestampLike): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
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
  return date ? date.toLocaleDateString("en-AU") : "";
}

function formatCurrency(value: number) {
  try {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
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

async function readAsiLogoBytes() {
  const filePath = path.join(process.cwd(), "public", "logos", "ASI BRANDING - OFFICIAL MAIN.png");
  return fs.readFile(filePath);
}

async function fetchImageBytes(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Image fetch failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function resolveStorageBucketName() {
  const fromRuntime =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;
  if (fromRuntime?.trim()) return fromRuntime.trim();

  const fromPublic = getPublicEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");
  if (typeof fromPublic === "string" && fromPublic.trim()) return fromPublic.trim();

  const fromAdminApp = admin.app().options.storageBucket;
  if (typeof fromAdminApp === "string" && fromAdminApp.trim()) return fromAdminApp.trim();

  return "";
}

function resolveRepairTypeLabel(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return REPAIR_TYPE_LABELS[trimmed] || trimmed;
}

function resolveVehicleLabel(report: any, index: number) {
  const vehicle = report?.vehicle || {};
  return (
    safeString(vehicle.registration) ||
    safeString(vehicle.fleetAssetNumber) ||
    safeString(vehicle.vin) ||
    `Vehicle ${index + 1}`
  );
}

function extractQuoteData(inspectionData: Record<string, any>) {
  const vehicleReports = Array.isArray(inspectionData.vehicleReports) ? inspectionData.vehicleReports : [];

  const lineItems = vehicleReports.flatMap((report: any, reportIndex: number) => {
    const vehicleLabel = resolveVehicleLabel(report, reportIndex);
    const damages = Array.isArray(report?.damages) ? report.damages : [];
    return damages.map((damage: any) => {
      const labour = safeNumber(damage.labourCost);
      const materials = safeNumber(damage.materialsCost);
      const total =
        safeNumber(damage.totalCost) ||
        (labour || materials ? labour + materials : safeNumber(damage.estimatedCost));
      const downtimeHours = safeNumber(damage.estimatedDowntimeHours);

      return {
        vehicleLabel,
        repairType: resolveRepairTypeLabel(damage.repairType) || "-",
        location: safeString(damage.location) || "-",
        description: safeString(damage.description) || "-",
        labour,
        materials,
        total,
        downtimeHours: downtimeHours > 0 ? downtimeHours : 0,
      };
    });
  });

  const totals = lineItems.reduce(
    (acc: { labour: number; materials: number; total: number }, item: any) => ({
      labour: acc.labour + safeNumber(item.labour),
      materials: acc.materials + safeNumber(item.materials),
      total: acc.total + safeNumber(item.total),
    }),
    { labour: 0, materials: 0, total: 0 }
  );

  const totalDowntimeHours = lineItems.reduce((sum: number, item: any) => sum + safeNumber(item.downtimeHours), 0);

  const flattenedPhotos = vehicleReports
    .flatMap((report: any) =>
      Array.isArray(report?.damages)
        ? report.damages.flatMap((damage: any) => {
            const preferred = Array.isArray(damage?.preWorkPhotos) ? damage.preWorkPhotos : [];
            const fallback = Array.isArray(damage?.photoUrls) ? damage.photoUrls : [];
            return [...preferred, ...fallback];
          })
        : []
    )
    .filter((url: unknown): url is string => typeof url === "string" && url.trim().length > 0);

  const uniquePhotos = Array.from(new Set(flattenedPhotos)).slice(0, 8);

  return {
    vehicleReports,
    lineItems,
    totals,
    totalDowntimeHours,
    photoUrls: uniquePhotos,
  };
}

async function generateQuotePdfBytes(params: {
  inspection: Record<string, any>;
  logoBytes: Buffer;
}): Promise<Buffer> {
  const { inspection, logoBytes } = params;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoImage = await pdfDoc.embedPng(logoBytes);

  const pageSize: [number, number] = [595.28, 841.89]; // A4
  const page = pdfDoc.addPage(pageSize);
  const { width, height } = page.getSize();
  const margin = 36;

  const logoDims = logoImage.scale(0.18);
  const headerY = height - margin;

  page.drawImage(logoImage, {
    x: margin,
    y: headerY - logoDims.height,
    width: logoDims.width,
    height: logoDims.height,
  });

  page.drawText("Inspection Quote", {
    x: margin + logoDims.width + 12,
    y: headerY - 18,
    size: 16,
    font: bold,
    color: rgb(0.1, 0.1, 0.1),
  });

  const inspectionNumber = safeString(inspection.inspectionNumber);
  const quoteDate = formatDate(admin.firestore.Timestamp.now());
  const metaText = inspectionNumber
    ? `Quote ref: ${inspectionNumber} - Generated: ${quoteDate}`
    : `Generated: ${quoteDate}`;
  page.drawText(metaText, {
    x: margin + logoDims.width + 12,
    y: headerY - 36,
    size: 9,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });

  const { lineItems, totals, totalDowntimeHours, photoUrls } = extractQuoteData(inspection);

  const contactName = safeString(inspection.contactName);
  const contactEmail = safeString(inspection.clientEmail);
  const clientName = safeString(inspection.clientName || inspection.organizationName);
  const siteName = safeString(inspection?.siteLocation?.name);
  const scheduledDate = formatDate(inspection.scheduledDate);
  const scheduledTime = safeString(inspection.scheduledTime);

  const legacyDowntimeValue = safeNumber(inspection?.estimatedDowntime?.value);
  const legacyDowntimeUnit = safeString(inspection?.estimatedDowntime?.unit) as "hours" | "days" | "";
  const legacyDowntimeText =
    legacyDowntimeValue > 0 && (legacyDowntimeUnit === "hours" || legacyDowntimeUnit === "days")
      ? `${legacyDowntimeValue} ${legacyDowntimeUnit}`
      : "";
  const estDowntimeText =
    totalDowntimeHours > 0
      ? `${(Math.round(totalDowntimeHours * 10) / 10).toString().replace(/\\.0$/, "")} hrs`
      : legacyDowntimeText;

  const leftColX = margin;
  const rightColX = Math.round(width * 0.52);
  let cursorY = headerY - Math.max(logoDims.height, 52) - 12;

  const drawKeyValue = (label: string, value: string, x: number, y: number) => {
    page.drawText(label, { x, y, size: 8.5, font, color: rgb(0.45, 0.45, 0.45) });
    page.drawText(value || "-", {
      x,
      y: y - 12,
      size: 10,
      font: bold,
      color: rgb(0.12, 0.12, 0.12),
    });
  };

  drawKeyValue("Client", clientName, leftColX, cursorY);
  drawKeyValue("Contact", contactName || contactEmail, rightColX, cursorY);
  cursorY -= 34;
  drawKeyValue("Site", siteName, leftColX, cursorY);
  drawKeyValue("Inspection date/time", `${scheduledDate} ${scheduledTime}`.trim(), rightColX, cursorY);
  cursorY -= 34;

  const vehicleLine = (() => {
    const labels = Array.from(
      new Set(lineItems.map((item: any) => safeString(item.vehicleLabel)).filter(Boolean))
    );
    return labels.length > 0 ? labels.join(" | ") : "Vehicle details not provided";
  })();

  page.drawText("Vehicle summary", {
    x: leftColX,
    y: cursorY,
    size: 8.5,
    font,
    color: rgb(0.45, 0.45, 0.45),
  });
  wrapText(vehicleLine, width - margin * 2, bold, 10)
    .slice(0, 2)
    .forEach((line, index) => {
      page.drawText(line, {
        x: leftColX,
        y: cursorY - 12 - index * 12,
        size: 10,
        font: bold,
        color: rgb(0.12, 0.12, 0.12),
      });
    });
  cursorY -= 40;

  const tableTop = cursorY;
  const tableLeft = margin;
  const tableWidth = width - margin * 2;
  const rowHeight = 18;
  const headerHeight = 20;
  const colVehicle = 76;
  const colRepair = 76;
  const colLocation = 72;
  const colDuration = 60;
  const colCost = 70;
  const colDesc = tableWidth - colVehicle - colRepair - colLocation - colDuration - colCost;

  page.drawRectangle({
    x: tableLeft,
    y: tableTop - headerHeight,
    width: tableWidth,
    height: headerHeight,
    color: rgb(0.95, 0.95, 0.97),
    borderColor: rgb(0.85, 0.85, 0.9),
    borderWidth: 1,
  });

  const headerYPos = tableTop - 14;
  page.drawText("Vehicle", { x: tableLeft + 6, y: headerYPos, size: 9, font: bold });
  page.drawText("Repair type", { x: tableLeft + colVehicle + 6, y: headerYPos, size: 9, font: bold });
  page.drawText("Location", {
    x: tableLeft + colVehicle + colRepair + 6,
    y: headerYPos,
    size: 9,
    font: bold,
  });
  page.drawText("Duration", {
    x: tableLeft + colVehicle + colRepair + colLocation + 6,
    y: headerYPos,
    size: 9,
    font: bold,
  });
  page.drawText("Description", {
    x: tableLeft + colVehicle + colRepair + colLocation + colDuration + 6,
    y: headerYPos,
    size: 9,
    font: bold,
  });
  page.drawText("Total", { x: tableLeft + tableWidth - colCost + 6, y: headerYPos, size: 9, font: bold });

  const maxRows = Math.max(1, Math.min(10, Math.floor((tableTop - 260) / rowHeight)));
  const rows = lineItems.slice(0, maxRows);
  let rowY = tableTop - headerHeight;

  rows.forEach((item: any, index: number) => {
    rowY -= rowHeight;
    const shade = index % 2 === 0 ? rgb(1, 1, 1) : rgb(0.985, 0.985, 0.99);
    page.drawRectangle({
      x: tableLeft,
      y: rowY,
      width: tableWidth,
      height: rowHeight,
      color: shade,
      borderColor: rgb(0.9, 0.9, 0.93),
      borderWidth: 1,
    });

    const vehicleLabel = truncate(safeString(item.vehicleLabel) || "-", 14);
    const repairType = truncate(safeString(item.repairType) || "-", 16);
    const location = truncate(safeString(item.location) || "-", 14);
    const downtimeHours = safeNumber(item.downtimeHours);
    const downtimeText =
      downtimeHours > 0
        ? `${(Math.round(downtimeHours * 10) / 10).toString().replace(/\\.0$/, "")}h`
        : "-";
    const description = truncate(safeString(item.description) || "-", 32);
    const total = safeNumber(item.total);

    page.drawText(vehicleLabel, { x: tableLeft + 6, y: rowY + 5, size: 8.5, font });
    page.drawText(repairType, { x: tableLeft + colVehicle + 6, y: rowY + 5, size: 8.5, font });
    page.drawText(location, {
      x: tableLeft + colVehicle + colRepair + 6,
      y: rowY + 5,
      size: 8.5,
      font,
    });
    page.drawText(downtimeText, {
      x: tableLeft + colVehicle + colRepair + colLocation + 6,
      y: rowY + 5,
      size: 8.5,
      font,
    });
    page.drawText(description, {
      x: tableLeft + colVehicle + colRepair + colLocation + colDuration + 6,
      y: rowY + 5,
      size: 8.5,
      font,
    });
    page.drawText(formatCurrency(total), {
      x: tableLeft + tableWidth - colCost + 6,
      y: rowY + 5,
      size: 8.5,
      font,
    });
  });

  cursorY = rowY - 18;
  if (lineItems.length > rows.length) {
    page.drawText(
      `+ ${lineItems.length - rows.length} more item(s) not shown due to 1-page quote limit.`,
      {
        x: margin,
        y: cursorY,
        size: 8.5,
        font,
        color: rgb(0.45, 0.45, 0.45),
      }
    );
    cursorY -= 14;
  }

  page.drawText(`Total Estimated Cost: ${formatCurrency(totals.total)}`, {
    x: margin,
    y: cursorY,
    size: 10,
    font: bold,
    color: rgb(0.12, 0.12, 0.12),
  });
  cursorY -= 14;
  page.drawText(`Works Downtime Allocation Required: ${estDowntimeText || "Not provided"}`, {
    x: margin,
    y: cursorY,
    size: 9.5,
    font: bold,
    color: rgb(0.2, 0.2, 0.24),
  });
  cursorY -= 20;

  if (photoUrls.length > 0) {
    page.drawText("Section 2 - Inspection photos", {
      x: margin,
      y: cursorY,
      size: 9,
      font: bold,
      color: rgb(0.25, 0.25, 0.3),
    });
    cursorY -= 10;

    const thumbSize = 62;
    const gap = 8;
    const perRow = 7;
    let imageX = margin;
    let imageY = cursorY - thumbSize;

    for (let index = 0; index < photoUrls.length; index += 1) {
      const url = photoUrls[index];
      try {
        const bytes = await fetchImageBytes(url);
        let img: any = null;
        try {
          img = await pdfDoc.embedJpg(bytes);
        } catch {
          img = await pdfDoc.embedPng(bytes);
        }
        page.drawRectangle({
          x: imageX,
          y: imageY,
          width: thumbSize,
          height: thumbSize,
          borderColor: rgb(0.85, 0.85, 0.9),
          borderWidth: 1,
        });
        const dims = img.scale(Math.min(thumbSize / img.width, thumbSize / img.height));
        page.drawImage(img, {
          x: imageX + (thumbSize - dims.width) / 2,
          y: imageY + (thumbSize - dims.height) / 2,
          width: dims.width,
          height: dims.height,
        });
      } catch {
        page.drawRectangle({
          x: imageX,
          y: imageY,
          width: thumbSize,
          height: thumbSize,
          borderColor: rgb(0.85, 0.85, 0.9),
          borderWidth: 1,
          color: rgb(0.97, 0.97, 0.98),
        });
        page.drawText("Image", { x: imageX + 18, y: imageY + 26, size: 8, font });
      }

      const nextX = imageX + thumbSize + gap;
      if ((index + 1) % perRow === 0 || nextX + thumbSize > width - margin) {
        imageX = margin;
        imageY -= thumbSize + gap;
      } else {
        imageX = nextX;
      }
    }
    cursorY = imageY - 12;
  } else {
    page.drawText("Section 2 - Inspection photos: none attached", {
      x: margin,
      y: cursorY,
      size: 9,
      font,
      color: rgb(0.4, 0.4, 0.45),
    });
    cursorY -= 14;
  }

  const actionHeight = 82;
  let actionPage = page;
  let actionTop = cursorY;
  if (actionTop - actionHeight < margin + 20) {
    actionPage = pdfDoc.addPage(pageSize);
    actionTop = actionPage.getSize().height - margin;
  }

  actionPage.drawRectangle({
    x: margin,
    y: actionTop - actionHeight,
    width: width - margin * 2,
    height: actionHeight,
    color: rgb(0.08, 0.1, 0.14),
    borderColor: rgb(0.2, 0.25, 0.33),
    borderWidth: 1,
    opacity: 0.95,
  });

  actionPage.drawText("Section 3 - Reply by email to approve", {
    x: margin + 10,
    y: actionTop - 18,
    size: 10.5,
    font: bold,
    color: rgb(0.95, 0.95, 0.98),
  });

  const actionBody =
    "Reply confirming approved scope (full or partial), PO/Works Order Number, and your allocated date/time " +
    "for the works. You can review full-size photos via the ASI Portal link in the email.";
  wrapText(actionBody, width - margin * 2 - 20, font, 9)
    .slice(0, 4)
    .forEach((line, index) => {
      actionPage.drawText(line, {
        x: margin + 10,
        y: actionTop - 34 - index * 12,
        size: 9,
        font,
        color: rgb(0.9, 0.9, 0.95),
      });
    });

  actionPage.drawText("Controlled record. Uncontrolled if printed.", {
    x: margin,
    y: margin - 18,
    size: 8,
    font,
    color: rgb(0.5, 0.5, 0.5),
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
async function generateAndStoreQuote(params: {
  inspectionId: string;
  inspection: Record<string, any>;
  generatedBy: { userId: string; name: string };
}): Promise<GenerateResult> {
  const bucketName = resolveStorageBucketName();
  if (!bucketName) {
    throw new Error(
      "Firebase Storage bucket not configured. Set NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET (or FIREBASE_STORAGE_BUCKET) in your runtime env vars."
    );
  }
  const bucket = admin.storage().bucket(bucketName);

  const logoBytes = await readAsiLogoBytes();
  const pdfBuffer = await generateQuotePdfBytes({ inspection: params.inspection, logoBytes });

  const safeInspectionNumber = safeString(params.inspection.inspectionNumber || params.inspectionId);
  const fileName = `${safeInspectionNumber.replace(/[^a-zA-Z0-9._-]/g, "_")}_Quote.pdf`;
  const storagePath = `inspection-quotes/${params.inspectionId}/${fileName}`;
  const token = crypto.randomUUID();

  await bucket.file(storagePath).save(pdfBuffer, {
    contentType: "application/pdf",
    metadata: {
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  const downloadUrl = buildDownloadUrl(bucket.name, storagePath, token);
  const file: InspectionQuoteFile = {
    fileName,
    storagePath,
    downloadUrl,
    contentType: "application/pdf",
    size: pdfBuffer.length,
  };

  const now = admin.firestore.FieldValue.serverTimestamp();
  await admin
    .firestore()
    .collection(COLLECTIONS.INSPECTIONS)
    .doc(params.inspectionId)
    .set(
      {
        quote: {
          status: "generated",
          file,
          generatedAt: now,
          generatedById: params.generatedBy.userId,
          generatedByName: params.generatedBy.name,
        },
        updatedAt: now,
      },
      { merge: true }
    );

  return { file };
}

async function queueEmail(params: { to: string; subject: string; text: string; html?: string }) {
  await admin.firestore().collection(COLLECTIONS.MAIL).add({
    to: [params.to],
    message: {
      subject: params.subject,
      text: params.text,
      ...(params.html ? { html: params.html } : {}),
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const adminUser = await requireAdminUser(req);
    const { userId, user } = adminUser;
    const senderName = user?.name || user?.email || "ASI Admin";

    const payload = (await req.json().catch(() => ({}))) as {
      inspectionId?: string;
      action?: "generate" | "send" | "generate_and_send";
      toEmail?: string;
      note?: string;
    };

    const inspectionId = safeString(payload.inspectionId);
    if (!inspectionId) {
      return NextResponse.json({ error: "inspectionId is required." }, { status: 400 });
    }

    const inspectionRef = admin.firestore().collection(COLLECTIONS.INSPECTIONS).doc(inspectionId);
    const inspectionSnap = await inspectionRef.get();
    if (!inspectionSnap.exists) {
      return NextResponse.json({ error: "Inspection not found." }, { status: 404 });
    }
    const inspection = (inspectionSnap.data() || {}) as Record<string, any>;

    const action = payload.action || "generate";
    if (action !== "generate" && action !== "send" && action !== "generate_and_send") {
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }

    let file: InspectionQuoteFile | null = inspection?.quote?.file || null;

    if (action === "generate" || action === "generate_and_send" || !file?.downloadUrl) {
      const generated = await generateAndStoreQuote({
        inspectionId,
        inspection,
        generatedBy: { userId, name: senderName },
      });
      file = generated.file;
    }

    if (action === "send" || action === "generate_and_send") {
      const recipient =
        safeString(payload.toEmail) ||
        safeString(inspection?.clientEmail) ||
        safeString(inspection?.quote?.sentTo);
      if (!recipient) {
        return NextResponse.json(
          { error: "Recipient email missing. Provide toEmail or set clientEmail on the inspection." },
          { status: 400 }
        );
      }

      const inspectionNumber = safeString(inspection.inspectionNumber || "Inspection quote");
      const subject = `ASI Inspection Quote: ${inspectionNumber}`;
      const clientName = safeString(inspection.clientName || inspection.organizationName);
      const contactName = safeString(inspection.contactName) || recipient;
      const appUrl = resolveAppUrl(req);
      const portalInspectionUrl = `${appUrl}/client/inspections/${inspectionId}`;
      const scheduled = `${formatDate(inspection.scheduledDate)} ${safeString(
        inspection.scheduledTime
      )}`.trim();
      const quoteData = extractQuoteData(inspection);
      const totalCostText = quoteData.totals.total > 0 ? formatCurrency(quoteData.totals.total) : "";
      const fallbackDowntimeValue = safeNumber(inspection?.estimatedDowntime?.value);
      const fallbackDowntimeUnit = safeString(inspection?.estimatedDowntime?.unit);
      const fallbackDowntimeText =
        fallbackDowntimeValue > 0 && (fallbackDowntimeUnit === "hours" || fallbackDowntimeUnit === "days")
          ? `${fallbackDowntimeValue} ${fallbackDowntimeUnit}`
          : "";
      const downtimeText =
        quoteData.totalDowntimeHours > 0
          ? `${(Math.round(quoteData.totalDowntimeHours * 10) / 10).toString().replace(/\\.0$/, "")} hrs`
          : fallbackDowntimeText;

      const text = `Hi ${contactName || "there"},

Please find your ASI inspection quote for ${clientName || "your organisation"}.

Inspection reference: ${inspectionNumber}
Inspection date/time: ${scheduled || "N/A"}
${totalCostText ? `Total estimate: ${totalCostText}\n` : ""}${downtimeText ? `Works Downtime Allocation Required: ${downtimeText}\n` : ""}

View/download quote (PDF): ${file?.downloadUrl || ""}
View inspection details and enlarge photos in ASI Portal: ${portalInspectionUrl}

To approve, reply to this email with:
1. Confirmed approved scope (full or partial line items)
2. PO/Works Order Number
3. Your allocated works date and time

Regards,
Advanced Surface Innovations (ASI) Australia`;

      const html = `
<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji'; line-height:1.5; color:#0f172a;">
  <p>Hi <strong>${contactName || "there"}</strong>,</p>
  <p>Please find your ASI inspection quote for <strong>${clientName || "your organisation"}</strong>.</p>
  <div style="padding:12px 14px; border:1px solid #e2e8f0; border-radius:10px; background:#f8fafc;">
    <div><strong>Inspection reference:</strong> ${inspectionNumber}</div>
    <div><strong>Inspection date/time:</strong> ${scheduled || "N/A"}</div>
    ${totalCostText ? `<div><strong>Total estimate:</strong> ${totalCostText}</div>` : ""}
    ${downtimeText ? `<div><strong>Works Downtime Allocation Required:</strong> ${downtimeText}</div>` : ""}
    <div><strong>Quote PDF:</strong> <a href="${file?.downloadUrl || "#"}">Download / view</a></div>
    <div><strong>Inspection portal view:</strong> <a href="${portalInspectionUrl}">Review summary and enlarge photos</a></div>
  </div>
  <p style="margin-top:14px;"><strong>Reply to approve with:</strong></p>
  <ol style="margin-top:6px; padding-left:18px;">
    <li>Approved scope of works (full or partial line items)</li>
    <li>PO/Works Order Number</li>
    <li>Allocated works date and time</li>
  </ol>
  <p>Regards,<br/>Advanced Surface Innovations (ASI) Australia</p>
</div>`;

      await queueEmail({ to: recipient, subject, text, html });

      const now = admin.firestore.FieldValue.serverTimestamp();
      await inspectionRef.set(
        {
          quote: {
            status: "sent",
            file,
            sentAt: now,
            sentTo: recipient,
            sentById: userId,
            sentByName: senderName,
            note: safeString(payload.note),
          },
          updatedAt: now,
        },
        { merge: true }
      );
    }

    return NextResponse.json({ ok: true, file });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate quote.";
    console.error("Inspection quote API failed:", error);
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

