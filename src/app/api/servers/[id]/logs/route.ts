import { proxyAgentStream } from "@/lib/stream-proxy";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tail = new URL(request.url).searchParams.get("tail") ?? "200";

  return proxyAgentStream(
    request,
    id,
    `/servers/${id}/logs?tail=${encodeURIComponent(tail)}`,
  );
}
