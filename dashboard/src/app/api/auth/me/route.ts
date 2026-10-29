import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ user: null }, { status: 401 });
  return Response.json({ user: { id: user.id, email: user.email } });
}
