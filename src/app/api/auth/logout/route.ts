import { NextResponse, type NextRequest } from "next/server";
import { handleApi } from "@/lib/api";
import { destroySession, SESSION_COOKIE } from "@/lib/auth/session";

export const POST = handleApi(async (req: NextRequest) => {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
