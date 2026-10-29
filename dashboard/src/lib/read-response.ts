export async function readResponseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data = await response.json();
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch {
    /* error pages are often HTML or empty */
  }
  return {};
}

export function errorText(data: Record<string, unknown>, fallback: string) {
  return typeof data.error === "string" && data.error ? data.error : fallback;
}
