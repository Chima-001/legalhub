/*
  Generates a small round "initials avatar" (like Slack/Gmail default
  avatars) - no photo upload/storage needed. Deliberately skipping real
  photo uploads for now (adds storage complexity for something purely
  cosmetic) - this gets the same professional look without it.

  Usage in any protected page's header:

    <a href="profile.html">
      <div id="header-avatar" class="w-9 h-9 rounded-full flex items-center
           justify-center text-white text-sm font-semibold"></div>
    </a>

    <script src="supabase-client.js"></script>
    <script src="avatar.js"></script>
    <script>
      supabaseClient.auth.getSession().then(({ data: { session } }) => {
        if (!session) return;
        supabaseClient.from("users").select("username, full_name")
          .eq("id", session.user.id).single()
          .then(({ data }) => {
            if (data) renderAvatar(document.getElementById("header-avatar"), data.username || data.full_name);
          });
      });
    </script>
*/

const AVATAR_COLORS = ["#c98a1f", "#4b5563", "#0f766e", "#7c3aed", "#b91c1c", "#0369a1"];

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function colorFromName(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function renderAvatar(el, name, extraClasses = "") {
  if (!el) return;
  el.textContent = getInitials(name);
  el.style.backgroundColor = colorFromName(name);
  if (extraClasses) el.className += " " + extraClasses;
}

async function loadHeaderAvatar(el) {
  if (!el || typeof supabaseClient === "undefined") return;
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;

  const { data } = await supabaseClient
    .from("users")
    .select("avatar_path, username, full_name")
    .eq("id", session.user.id)
    .single();

  if (!data) return;
  renderAvatar(el, data.username || data.full_name);
  if (!data.avatar_path) return;

  const { data: publicUrl } = supabaseClient.storage.from("avatars").getPublicUrl(data.avatar_path);
  if (!publicUrl?.publicUrl) return;
  el.textContent = "";
  const image = document.createElement("img");
  image.src = publicUrl.publicUrl;
  image.alt = "Your profile";
  image.loading = "lazy";
  image.addEventListener("error", () => renderAvatar(el, data.username || data.full_name), { once: true });
  el.appendChild(image);
}
