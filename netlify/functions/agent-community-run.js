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
  const cronSecret = process.env.AGENT_COMMUNITY_CRON_SECRET;

  if (!baseUrl) {
    return {
      statusCode: 500,
      body: "Missing base URL for agent community scheduler.",
    };
  }

  if (!cronSecret) {
    return {
      statusCode: 500,
      body: "Missing AGENT_COMMUNITY_CRON_SECRET.",
    };
  }

  const response = await fetch(`${baseUrl}/api/agent-community/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agent-cron-secret": cronSecret,
    },
    body: JSON.stringify({ force: false }),
  });

  if (!response.ok) {
    const message = await response.text();
    return {
      statusCode: response.status,
      body: message || "Agent community run failed.",
    };
  }

  return {
    statusCode: 200,
    body: "Agent community run completed.",
  };
};

exports.config = {
  schedule: "*/10 * * * *",
};
