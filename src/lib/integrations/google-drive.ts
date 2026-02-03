import { google } from "googleapis";

type DriveAuthConfig = {
  clientEmail: string;
  privateKey: string;
};

const readServiceAccount = (): DriveAuthConfig => {
  const jsonB64 = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_B64;
  if (jsonB64) {
    const raw = Buffer.from(jsonB64, "base64").toString("utf8");
    const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("Invalid GOOGLE_DRIVE_SERVICE_ACCOUNT_B64 payload.");
    }
    return {
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    };
  }

  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const privateKeyBase64 = process.env.GOOGLE_DRIVE_PRIVATE_KEY_B64;
  const privateKey = privateKeyBase64
    ? Buffer.from(privateKeyBase64, "base64").toString("utf8").replace(/\\n/g, "\n")
    : undefined;

  if (!clientEmail || !privateKey) {
    throw new Error("Missing Google Drive service account credentials.");
  }

  return { clientEmail, privateKey };
};

export const getDriveClient = () => {
  const authConfig = readServiceAccount();
  const auth = new google.auth.JWT({
    email: authConfig.clientEmail,
    key: authConfig.privateKey,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
};

export const listDriveFiles = async (folderId: string, pageSize = 25) => {
  const drive = getDriveClient();
  const sharedDriveId = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID || undefined;
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    pageSize,
    fields:
      "files(id,name,mimeType,modifiedTime,webViewLink,webContentLink,size)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: sharedDriveId ? "drive" : "user",
    driveId: sharedDriveId,
  });
  return response.data.files || [];
};

export const downloadDriveFile = async (fileId: string) => {
  const drive = getDriveClient();
  const response = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(response.data as ArrayBuffer);
};

export const exportDriveFile = async (fileId: string, mimeType: string) => {
  const drive = getDriveClient();
  const response = await drive.files.export(
    { fileId, mimeType },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(response.data as ArrayBuffer);
};
