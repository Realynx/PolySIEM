import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { searchAll } from "@/lib/services/search";
import type { EntityKind } from "@/lib/types";
import { ENTITY_KINDS } from "@/lib/types";

export const GET = handleApi(async (req: NextRequest) => {
  await requireUser();
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const kindsParam = req.nextUrl.searchParams.get("kinds");
  const kinds = kindsParam
    ? (kindsParam.split(",").filter((k) => ENTITY_KINDS.includes(k as EntityKind)) as EntityKind[])
    : undefined;
  const results = await searchAll(q, kinds && kinds.length > 0 ? kinds : undefined);
  return jsonOk(results);
});
