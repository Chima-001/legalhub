// Deploy path: supabase/functions/r2-presign/index.ts
//
// Browser JavaScript can never hold your real R2 secret key (anyone could
// read it and access your whole bucket). Instead, the browser asks THIS
// function for a temporary presigned URL - one for uploading,
// one for viewing - and only this function (running on Supabase's server,
// never exposed to the browser) ever touches your actual R2 credentials.
//
// Deploy: supabase functions deploy r2-presign
// Secrets needed (set once):
//   supabase secrets set R2_ACCOUNT_ID=your-account-id
//   supabase secrets set R2_ACCESS_KEY_ID=your-access-key-id
//   supabase secrets set R2_SECRET_ACCESS_KEY=your-secret-access-key
//   supabase secrets set R2_BUCKET_NAME=legalhub-storage
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided)

// No runtime import of a type-declaration package. Deno supplies serve/env.
import { createClient } from "jsr:@supabase/supabase-js@2.119.2";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "npm:@aws-sdk/client-s3@3.1175.0";
import { removeReviewed } from "./removal.mjs";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.1175.0";

const accountId = Deno.env.get("R2_ACCOUNT_ID")!;
const bucketName = Deno.env.get("R2_BUCKET_NAME")!;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
    secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
  },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // TODO: narrow to your real site domain once live
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Operator non-mutating boot/contract check. A GET cannot authorize a presign, removal, or RPC.
  if (req.method !== "POST") return new Response(null, {
    status: 405,
    headers: { ...corsHeaders, Allow: "POST, OPTIONS", "Cache-Control": "no-store", "X-LegalHub-Storage-Contract": "reviewed-removal-v1" },
  });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders });
    }

    const body = await req.json();
    const { action, key, contentType, fileName } = body;
    if (action === "remove-reviewed") {
      const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const [status, result] = await removeReviewed(body, user.id, {
        rpc: (name: string, args: Record<string, unknown>) => service.rpc(name, args),
        removeObject: (objectKey: string) => s3.send(new DeleteObjectCommand({Bucket: bucketName, Key: objectKey})),
      });
      return Response.json(result, {status: Number(status), headers:corsHeaders});
    }
    // Old unreviewed reject requests are deliberately not supported.

    if (action === "upload") {
      const safeName = (fileName || "file.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
      const objectKey = `materials/${user.id}/${crypto.randomUUID()}_${safeName.slice(-220)}`;

      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
        ContentType: contentType || "application/pdf",
      });
      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5 min to upload

      return new Response(JSON.stringify({ uploadUrl, key: objectKey }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "download") {
      if (!key) {
        return new Response(JSON.stringify({ error: "Missing key" }), { status: 400, headers: corsHeaders });
      }

      // Check authorization the same way the old Supabase Storage RLS
      // policies did: allowed if the material is approved, OR the
      // requester is an admin. Uses the service role client so this
      // check works regardless of the caller's own RLS access.
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const { data: material } = await supabaseAdmin
        .from("materials")
        .select("status")
        .eq("storage_path", key)
        .single();

      const { data: userRow } = await supabaseAdmin
        .from("users")
        .select("is_admin")
        .eq("id", user.id)
        .single();

      const allowed = material && (material.status === "approved" || userRow?.is_admin === true);
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Not authorized to view this file" }), { status: 403, headers: corsHeaders });
      }

      const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
      const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour to view

      return new Response(JSON.stringify({ downloadUrl }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: corsHeaders });
  } catch {
    return new Response(JSON.stringify({ error: "Storage operation was not confirmed." }), { status: 500, headers: corsHeaders });
  }
});
