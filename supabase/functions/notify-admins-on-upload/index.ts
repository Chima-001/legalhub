// Deploy path: supabase/functions/notify-admins-on-upload/index.ts
//
// Triggered by a Database Webhook (set up in Supabase dashboard, not code -
// see instructions below) whenever a new row is INSERTed into `materials`.
//
// Deploy: supabase functions deploy notify-admins-on-upload
// Secrets needed (set once):
//   supabase secrets set RESEND_API_KEY=your-resend-key
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided)
//
// NOTE: without a verified domain, Resend's default sending address
// (onboarding@resend.dev) can only deliver to the Resend ACCOUNT OWNER'S
// own verified email by default. With two admins, add both admin emails
// as verified test recipients in Resend's dashboard (Settings > free
// testing) so both get notified even before your domain is set up. Once
// your domain + custom SMTP is live, this becomes unrestricted automatically -
// no code change needed here, just swap the "from" address below.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const record = payload.record; // { file_name, course, uploaded_by, ... }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: admins } = await supabaseAdmin
      .from("users")
      .select("email, full_name")
      .eq("is_admin", true);

    const { data: uploader } = await supabaseAdmin
      .from("users")
      .select("full_name")
      .eq("id", record.uploaded_by)
      .single();

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey || !admins?.length) {
      return new Response(JSON.stringify({ skipped: true, reason: "no key or no admins" }), { status: 200 });
    }

    for (const admin of admins) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "LegalHub <onboarding@resend.dev>", // TODO: swap to noreply@yourdomain.fyi once domain/SMTP is set up
          to: admin.email,
          subject: `New material pending review: ${record.file_name}`,
          html: `<p>${uploader?.full_name || "A student"} uploaded <strong>${record.file_name}</strong>${record.course ? ` (${record.course})` : ""}. Log in to review and approve it.</p>`,
        }),
      });
    }

    return new Response(JSON.stringify({ notified: admins.length }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
