import { pipe } from "@/lib/proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (req: Request) => pipe(req, "/api/events");
