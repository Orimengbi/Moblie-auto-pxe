import { jsonError, readJson } from "@/lib/api";
import { createProfile, listProfiles, publicProfile } from "@/lib/store";
import type { ProfileInput } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listProfiles().map(publicProfile));
}

export async function POST(request: Request) {
  try {
    const body = await readJson<ProfileInput>(request);
    const profile = await createProfile(body);
    return Response.json(publicProfile(profile), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
