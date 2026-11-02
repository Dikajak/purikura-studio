import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const bucketName = "purikura-shares";
const maxBatchSize = 100;
const staleUploadMs = 60 * 60 * 1000;

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const cleanupSecret = Deno.env.get("CLEANUP_SECRET");
const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  : null;

type ExpiredGallery = {
  gallery_id: string;
  png_path: string;
  gif_path: string;
  created_at: string;
  expires_at: string;
  cleanup_started_at: string | null;
  creation_status: "uploading" | "complete" | "failed" | "cleaning";
};

function matchesSecret(provided: string, expected: string): boolean {
  const providedBytes = new TextEncoder().encode(provided);
  const expectedBytes = new TextEncoder().encode(expected);
  if (providedBytes.length !== expectedBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < providedBytes.length; index++) {
    difference |= providedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!cleanupSecret || !matchesSecret(
    request.headers.get("x-cleanup-secret") ?? "",
    cleanupSecret,
  )) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!supabase) {
    return Response.json({ error: "cleanup_service_not_configured" }, { status: 500 });
  }

  const cutoff = new Date(Date.now() - staleUploadMs).toISOString();
  const cleanupRecoveryCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("purikura_share_galleries")
    .select("gallery_id, png_path, gif_path, created_at, expires_at, cleanup_started_at, creation_status")
    .or(`and(expires_at.lte.${now},creation_status.neq.uploading),and(creation_status.eq.uploading,created_at.lte.${cutoff}),and(creation_status.eq.cleaning,cleanup_started_at.lte.${cleanupRecoveryCutoff})`)
    .order("expires_at", { ascending: true })
    .limit(maxBatchSize);

  if (error) {
    return Response.json({ error: "cleanup_query_failed" }, { status: 503 });
  }

  let deleted = 0;
  let failures = 0;
  for (const gallery of (data ?? []) as ExpiredGallery[]) {
    const cleanupStartedAt = new Date().toISOString();
    let claimQuery = supabase
      .from("purikura_share_galleries")
      .update({
        creation_status: "cleaning",
        cleanup_started_at: cleanupStartedAt,
      })
      .eq("gallery_id", gallery.gallery_id);
    if (gallery.creation_status === "cleaning") {
      claimQuery = claimQuery
        .eq("creation_status", "cleaning")
        .lte("cleanup_started_at", cleanupRecoveryCutoff);
    } else {
      claimQuery = claimQuery.eq("creation_status", gallery.creation_status);
    }
    const { data: claimed, error: claimError } = await claimQuery
      .select("gallery_id")
      .maybeSingle();
    if (claimError) {
      failures++;
      continue;
    }
    if (!claimed) continue;

    const { error: storageError } = await supabase.storage
      .from(bucketName)
      .remove([gallery.png_path, gallery.gif_path]);
    if (storageError) {
      failures++;
      if (gallery.creation_status !== "cleaning") {
        await supabase
          .from("purikura_share_galleries")
          .update({
            creation_status: gallery.creation_status,
            cleanup_started_at: null,
          })
          .eq("gallery_id", gallery.gallery_id)
          .eq("creation_status", "cleaning")
          .eq("cleanup_started_at", cleanupStartedAt);
      }
      continue;
    }

    const { error: deleteError } = await supabase
      .from("purikura_share_galleries")
      .delete()
      .eq("gallery_id", gallery.gallery_id)
      .eq("creation_status", "cleaning")
      .eq("cleanup_started_at", cleanupStartedAt);
    if (deleteError) {
      failures++;
      continue;
    }
    deleted++;
  }

  return Response.json({ deleted, failures });
});
