/**
 * GET /api/ai/status
 *
 * Says whether this deployment has AI configured, without revealing which
 * provider or leaking anything about the credential. The client asks once and
 * caches the answer; a `false` here is a completely supported state and simply
 * means the product runs on its rules engine.
 */

import { readConfig, requireMethod, type ApiRequest, type ApiResponse } from "../_ai";

export default function handler(request: ApiRequest, response: ApiResponse): void {
  if (!requireMethod(request, response, "GET")) return;

  response.setHeader("cache-control", "public, max-age=60");
  response.status(200).json({ configured: readConfig() !== null });
}
