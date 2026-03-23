/**
 * OAuth Authorization Server Metadata (RFC 8414)
 * mcp-remote checks this endpoint during HTTP transport discovery.
 * Returning a valid JSON response (not HTML 404) prevents mcp-remote
 * from falling back to SSE transport.
 */
export async function GET() {
  return Response.json(
    {
      issuer: process.env.NEXT_PUBLIC_SITE_URL || "https://asiportal.live",
      response_types_supported: [],
      grant_types_supported: [],
    },
    { status: 200 }
  );
}
