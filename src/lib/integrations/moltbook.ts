type MoltbookRequest = {
  url: string;
  body: Record<string, unknown>;
};

export type MoltbookRegisterPayload = {
  name: string;
  description?: string;
  website?: string;
};

export type MoltbookPostPayload = {
  title: string;
  body: string;
  tags?: string[];
};

export type MoltbookCommentPayload = {
  postId: string;
  body: string;
};

export type MoltbookReactionPayload = {
  postId: string;
  reaction: string;
};

const resolveBaseUrl = () => {
  const base = process.env.MOLTBOOK_BASE_URL?.trim();
  return base && base.length > 0 ? base.replace(/\/$/, "") : "https://www.moltbook.com";
};

const resolveApiKey = () => {
  const apiKey = process.env.MOLTBOOK_API_KEY;
  if (!apiKey) {
    throw new Error("Missing MOLTBOOK_API_KEY.");
  }
  return apiKey;
};

const requestWithFallback = async (
  requests: MoltbookRequest[],
  apiKey: string
) => {
  const errors: string[] = [];
  for (const request of requests) {
    try {
      const response = await fetch(request.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request.body),
      });
      if (!response.ok) {
        const text = await response.text();
        errors.push(`${request.url} -> ${response.status} ${text}`);
        continue;
      }
      const data = await response.json();
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      errors.push(`${request.url} -> ${message}`);
    }
  }
  throw new Error(`Moltbook request failed. ${errors.join(" | ")}`);
};

export const registerMoltbookAgent = async (payload: MoltbookRegisterPayload) => {
  const baseUrl = resolveBaseUrl();
  const apiKey = resolveApiKey();
  const requests: MoltbookRequest[] = [
    { url: `${baseUrl}/api/v1/agents/register`, body: payload },
    { url: `${baseUrl}/api/v1/register`, body: payload },
    { url: `${baseUrl}/api/register`, body: payload },
  ];
  return requestWithFallback(requests, apiKey);
};

export const createMoltbookPost = async (payload: MoltbookPostPayload) => {
  const baseUrl = resolveBaseUrl();
  const apiKey = resolveApiKey();
  const requests: MoltbookRequest[] = [
    { url: `${baseUrl}/api/v1/feed`, body: payload },
    { url: `${baseUrl}/api/v1/posts`, body: payload },
    { url: `${baseUrl}/api/posts`, body: payload },
  ];
  return requestWithFallback(requests, apiKey);
};

export const createMoltbookComment = async (payload: MoltbookCommentPayload) => {
  const baseUrl = resolveBaseUrl();
  const apiKey = resolveApiKey();
  const requests: MoltbookRequest[] = [
    { url: `${baseUrl}/api/v1/comments`, body: payload },
    { url: `${baseUrl}/api/comments`, body: payload },
    { url: `${baseUrl}/api/v1/comments`, body: { post_id: payload.postId, body: payload.body } },
    { url: `${baseUrl}/api/comments`, body: { post_id: payload.postId, body: payload.body } },
  ];
  return requestWithFallback(requests, apiKey);
};

export const createMoltbookReaction = async (payload: MoltbookReactionPayload) => {
  const baseUrl = resolveBaseUrl();
  const apiKey = resolveApiKey();
  const requests: MoltbookRequest[] = [
    { url: `${baseUrl}/api/v1/reactions`, body: payload },
    { url: `${baseUrl}/api/reactions`, body: payload },
    { url: `${baseUrl}/api/v1/reactions`, body: { post_id: payload.postId, reaction: payload.reaction } },
    { url: `${baseUrl}/api/reactions`, body: { post_id: payload.postId, reaction: payload.reaction } },
  ];
  return requestWithFallback(requests, apiKey);
};
