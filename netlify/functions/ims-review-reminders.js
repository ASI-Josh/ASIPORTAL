/**
 * Netlify Scheduled Function — IMS document review reminder trigger.
 *
 * Runs daily at 20:00 UTC (06:00 AEST). Pings the Next.js cron route which
 * does the actual work: scans active IMS documents, sends reminders at
 * T-30, T-14, T-0 days before reviewDueDate, and marks overdue docs.
 *
 * Env vars required:
 *   CRON_SECRET — shared secret matching the Next.js route's Bearer check
 *   URL / DEPLOY_PRIME_URL / NEXT_PUBLIC_APP_URL — base URL of the deployed app
 */

const buildBaseUrl = () => {
  return (
    process.env.DEPLOY_PRIME_URL ||
    process.env.URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ""
  ).replace(/\/$/, "");
};

exports.handler = async () => {
  const baseUrl = buildBaseUrl();
  const cronSecret = process.env.CRON_SECRET;

  if (!baseUrl) {
    return {
      statusCode: 500,
      body: "Missing base URL for IMS review reminders scheduler.",
    };
  }

  if (!cronSecret) {
    return {
      statusCode: 500,
      body: "Missing CRON_SECRET env var.",
    };
  }

  const response = await fetch(`${baseUrl}/api/cron/ims-review-reminders`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
    },
  });

  const body = await response.text();

  if (!response.ok) {
    return {
      statusCode: response.status,
      body: body || "IMS review reminders run failed.",
    };
  }

  return {
    statusCode: 200,
    body: body || "IMS review reminders run completed.",
  };
};

exports.config = {
  schedule: "0 20 * * *",
};
