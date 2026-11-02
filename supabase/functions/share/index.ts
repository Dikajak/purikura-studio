import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const bucketName = "purikura-shares";
const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
const maxPngBytes = 3 * 1024 * 1024;
const maxGifBytes = 4 * 1024 * 1024;
const maxRequestBytes = 5 * 1024 * 1024;
const signedUrlMaxAgeSeconds = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  : null;

type Gallery = {
  gallery_id: string;
  token_hash: string;
  request_digest: string | null;
  png_path: string;
  gif_path: string;
  created_at: string;
  expires_at: string;
  creation_status: "uploading" | "complete" | "failed" | "cleaning";
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

function isToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requestDigest(png: Uint8Array, gif: Uint8Array): Promise<string> {
  const pngHash = await sha256(png);
  const gifHash = await sha256(gif);
  return await sha256(encoder.encode(`${png.length}:${pngHash}\n${gif.length}:${gifHash}`));
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a;
}

function isGif(bytes: Uint8Array): boolean {
  return bytes.length >= 6 &&
    String.fromCharCode(...bytes.slice(0, 6)).match(/^GIF8[79]a$/) !== null;
}

function getClient(): NonNullable<typeof supabase> {
  if (!supabase) throw new Error("Share service is not configured");
  return supabase;
}

async function findGallery(tokenHash: string): Promise<Gallery | null> {
  const { data, error } = await getClient()
    .from("purikura_share_galleries")
    .select("gallery_id, token_hash, request_digest, png_path, gif_path, created_at, expires_at, creation_status")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw new Error("Could not read gallery");
  return data as Gallery | null;
}

async function removeFiles(gallery: Gallery): Promise<void> {
  const { error } = await getClient().storage.from(bucketName).remove([
    gallery.png_path,
    gallery.gif_path,
  ]);
  if (error) throw new Error("Could not remove uploaded files");
}

async function deleteGallery(gallery: Gallery, status: Gallery["creation_status"]): Promise<void> {
  const { error } = await getClient()
    .from("purikura_share_galleries")
    .delete()
    .eq("gallery_id", gallery.gallery_id)
    .eq("creation_status", status);
  if (error) throw new Error("Could not remove gallery record");
}

async function claimFailedGallery(gallery: Gallery): Promise<boolean> {
  const { data, error } = await getClient()
    .from("purikura_share_galleries")
    .update({
      creation_status: "cleaning",
      cleanup_started_at: new Date().toISOString(),
    })
    .eq("gallery_id", gallery.gallery_id)
    .eq("creation_status", "failed")
    .select("gallery_id")
    .maybeSingle();
  if (error) throw new Error("Could not claim failed gallery");
  return Boolean(data);
}

async function markFailed(gallery: Gallery): Promise<boolean> {
  const { data, error } = await getClient()
    .from("purikura_share_galleries")
    .update({ creation_status: "failed", cleanup_started_at: null })
    .eq("gallery_id", gallery.gallery_id)
    .eq("creation_status", "uploading")
    .select("gallery_id")
    .maybeSingle();
  if (error) throw new Error("Could not mark gallery upload as failed");
  return Boolean(data);
}

async function finishIfAlreadyUploaded(
  gallery: Gallery,
  digest: string,
): Promise<boolean> {
  const storage = getClient().storage.from(bucketName);
  const [pngResult, gifResult] = await Promise.all([
    storage.download(gallery.png_path),
    storage.download(gallery.gif_path),
  ]);
  if (pngResult.error || gifResult.error || !pngResult.data || !gifResult.data) {
    return false;
  }
  const [png, gif] = await Promise.all([
    pngResult.data.arrayBuffer(),
    gifResult.data.arrayBuffer(),
  ]);
  if (await requestDigest(new Uint8Array(png), new Uint8Array(gif)) !== digest) {
    return false;
  }
  const { data: completed, error } = await getClient()
    .from("purikura_share_galleries")
    .update({ creation_status: "complete" })
    .eq("gallery_id", gallery.gallery_id)
    .eq("creation_status", "uploading")
    .select("gallery_id")
    .maybeSingle();
  if (error) throw new Error("Could not finish gallery");
  return Boolean(completed);
}

async function respondWithExisting(gallery: Gallery, digest: string): Promise<Response> {
  if (gallery.request_digest !== digest) {
    return jsonResponse({ error: "idempotency_key_reused_with_different_content" }, 409);
  }
  if (new Date(gallery.expires_at).getTime() <= Date.now()) {
    return jsonResponse({ error: "share_expired" }, 410);
  }
  if (gallery.creation_status === "complete") {
    return jsonResponse({ ok: true, expiresAt: gallery.expires_at });
  }
  if (gallery.creation_status === "failed") {
    try {
      if (!await claimFailedGallery(gallery)) {
        return jsonResponse({ error: "creation_in_progress_retry_shortly" }, 409);
      }
      await removeFiles(gallery);
      await deleteGallery(gallery, "cleaning");
      return jsonResponse({ retry: true });
    } catch {
      await getClient()
        .from("purikura_share_galleries")
        .update({ creation_status: "failed", cleanup_started_at: null })
        .eq("gallery_id", gallery.gallery_id)
        .eq("creation_status", "cleaning");
      return jsonResponse({ error: "retry_cleanup_failed" }, 503);
    }
  }
  if (gallery.creation_status === "cleaning") {
    return jsonResponse({ error: "creation_in_progress_retry_shortly" }, 409);
  }
  try {
    if (await finishIfAlreadyUploaded(gallery, digest)) {
      return jsonResponse({ ok: true, expiresAt: gallery.expires_at });
    }
  } catch {
    return jsonResponse({ error: "gallery_recovery_failed" }, 503);
  }
  return jsonResponse({ error: "creation_in_progress_retry_shortly" }, 409);
}

async function createShare(form: FormData): Promise<Response> {
  const tokenValue = form.get("token");
  const pngFile = form.get("png");
  const gifFile = form.get("gif");
  if (!isToken(tokenValue) || !(pngFile instanceof File) || !(gifFile instanceof File)) {
    return jsonResponse({ error: "token_png_and_gif_required" }, 400);
  }
  if (
    pngFile.type !== "image/png" || gifFile.type !== "image/gif" ||
    pngFile.size === 0 || pngFile.size > maxPngBytes ||
    gifFile.size === 0 || gifFile.size > maxGifBytes ||
    pngFile.size + gifFile.size > maxRequestBytes
  ) {
    return jsonResponse({ error: "invalid_file_type_or_size" }, 413);
  }

  const [pngBuffer, gifBuffer] = await Promise.all([
    pngFile.arrayBuffer(),
    gifFile.arrayBuffer(),
  ]);
  const png = new Uint8Array(pngBuffer);
  const gif = new Uint8Array(gifBuffer);
  if (!isPng(png) || !isGif(gif)) {
    return jsonResponse({ error: "file_contents_do_not_match_mime_type" }, 415);
  }

  const tokenHash = await sha256(encoder.encode(tokenValue));
  const digest = await requestDigest(png, gif);
  let existing: Gallery | null;
  try {
    existing = await findGallery(tokenHash);
  } catch {
    return jsonResponse({ error: "gallery_lookup_failed" }, 503);
  }
  if (existing) {
    const response = await respondWithExisting(existing, digest);
    if (response.status !== 200 || (await response.clone().json()).ok) return response;
    try {
      existing = await findGallery(tokenHash);
    } catch {
      return jsonResponse({ error: "gallery_lookup_failed" }, 503);
    }
    if (existing) {
      const retryResponse = await respondWithExisting(existing, digest);
      if (retryResponse.status !== 200 || (await retryResponse.clone().json()).ok) {
        return retryResponse;
      }
    }
  }

  const galleryId = crypto.randomUUID();
  const pngPath = `${galleryId}/photo.png`;
  const gifPath = `${galleryId}/photo.gif`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + sevenDaysMs).toISOString();
  const { data: inserted, error: insertError } = await getClient()
    .from("purikura_share_galleries")
    .insert({
      gallery_id: galleryId,
      token_hash: tokenHash,
      request_digest: digest,
      png_path: pngPath,
      gif_path: gifPath,
      created_at: createdAt.toISOString(),
      expires_at: expiresAt,
      creation_status: "uploading",
    })
    .select("gallery_id, token_hash, request_digest, png_path, gif_path, created_at, expires_at, creation_status")
    .maybeSingle();

  if (insertError || !inserted) {
    try {
      const racedGallery = await findGallery(tokenHash);
      if (racedGallery) return await respondWithExisting(racedGallery, digest);
    } catch {
      return jsonResponse({ error: "gallery_creation_failed" }, 503);
    }
    return jsonResponse({ error: "gallery_creation_failed" }, 503);
  }

  const gallery = inserted as Gallery;
  try {
    const storage = getClient().storage.from(bucketName);
    const pngUpload = await storage.upload(pngPath, png, {
      contentType: "image/png",
      upsert: false,
    });
    if (pngUpload.error) throw new Error("PNG upload failed");

    const gifUpload = await storage.upload(gifPath, gif, {
      contentType: "image/gif",
      upsert: false,
    });
    if (gifUpload.error) throw new Error("GIF upload failed");

    const { data: completed, error: finalizeError } = await getClient()
      .from("purikura_share_galleries")
      .update({ creation_status: "complete" })
      .eq("gallery_id", galleryId)
      .eq("creation_status", "uploading")
      .select("gallery_id")
      .maybeSingle();
    if (finalizeError) throw new Error("Gallery finalization failed");
    if (!completed) {
      const current = await findGallery(tokenHash);
      if (current?.creation_status !== "complete") {
        throw new Error("Gallery finalization failed");
      }
    }
    return jsonResponse({ ok: true, expiresAt });
  } catch {
    try {
      if (await markFailed(gallery)) {
        await removeFiles(gallery);
        await deleteGallery(gallery, "failed");
      } else {
        const current = await findGallery(tokenHash);
        if (current?.creation_status === "complete") {
          return jsonResponse({ ok: true, expiresAt: current.expires_at });
        }
      }
    } catch {
      // Keep the database record so the retry or scheduled cleanup can recover it.
    }
    return jsonResponse({ error: "upload_failed_retry" }, 502);
  }
}

async function lookupShare(body: Record<string, unknown>): Promise<Response> {
  if (!isToken(body.token)) return jsonResponse({ error: "invalid_token" }, 400);
  let gallery: Gallery | null;
  try {
    gallery = await findGallery(await sha256(encoder.encode(body.token)));
  } catch {
    return jsonResponse({ error: "gallery_lookup_failed" }, 503);
  }
  if (!gallery || gallery.creation_status !== "complete") {
    return jsonResponse({ error: "share_not_found" }, 404);
  }

  const now = Date.now();
  const expiresAt = new Date(gallery.expires_at).getTime();
  if (expiresAt <= now) return jsonResponse({ error: "share_expired" }, 410);
  const signedUrlSeconds = Math.min(
    signedUrlMaxAgeSeconds,
    Math.floor((expiresAt - now) / 1000),
  );
  if (signedUrlSeconds < 1) return jsonResponse({ error: "share_expired" }, 410);
  const storage = getClient().storage.from(bucketName);
  const [pngResult, gifResult] = await Promise.all([
    storage.createSignedUrl(gallery.png_path, signedUrlSeconds, { download: "purikura-studio.png" }),
    storage.createSignedUrl(gallery.gif_path, signedUrlSeconds, { download: "purikura-studio.gif" }),
  ]);
  if (pngResult.error || gifResult.error || !pngResult.data || !gifResult.data) {
    return jsonResponse({ error: "download_links_unavailable" }, 503);
  }
  return jsonResponse({
    ok: true,
    pngUrl: pngResult.data.signedUrl,
    gifUrl: gifResult.data.signedUrl,
    expiresAt: gallery.expires_at,
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  if (!supabase) return jsonResponse({ error: "share_service_not_configured" }, 500);

  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      return await createShare(form);
    }
    const body: unknown = await request.json();
    if (
      typeof body === "object" && body !== null &&
      "action" in body && body.action === "lookup"
    ) {
      return await lookupShare(body as Record<string, unknown>);
    }
    return jsonResponse({ error: "unsupported_request" }, 400);
  } catch {
    return jsonResponse({ error: "request_failed" }, 500);
  }
});
