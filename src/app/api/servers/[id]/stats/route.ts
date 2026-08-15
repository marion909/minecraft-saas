import { proxyAgentStream } from "@/lib/stream-proxy";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyAgentStream(request, id, `/servers/${id}/stats`);
}
