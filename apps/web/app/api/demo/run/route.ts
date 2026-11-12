import { pipe } from "@/lib/proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = (req: Request) => pipe(req, "/api/demo/run");
export const GET = (req: Request) => pipe(req, "/api/demo/run");
