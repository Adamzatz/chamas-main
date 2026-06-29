const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "chamas_main_token";

let authToken = localStorage.getItem(TOKEN_KEY) || "";
let me = null;
let state = null;
let config = { mixer_public_url: "https://chamas-mixer.shardweb.app" };
let currentView = "forYou";
let profileDraft = { display_name: "", about: "" };
let friendDraft = "";
let campaignDraft = "";
let inviteDrafts = {};

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

function headers(json = true) {
  const result = {};
  if (json) result["Content-Type"] = "application/json";
  if (authToken) result["X-Dashboard-Key"] = authToken;
  return result;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { ...headers(options.json !== false), ...(options.headers || {}) }
  });
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    throw new Error((data && data.detail) || String(data) || "Erro no servidor.");
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function escapeJs(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function initials(user) {
  const text = (user?.display_name || user?.name || "CM").trim();
  return text.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function avatar(user = me, size = "") {
  const url = user?.avatar_url || "";
  const cls = `avatar ${size} ${url ? "has-image" : ""}`.trim();
  const style = url ? ` style="background-image:url('${escapeHtml(url)}')"` : "";
  return `<span class="${cls}"${style}>${url ? "" : escapeHtml(initials(user))}</span>`;
}

function setAuthMode(mode) {
  $("loginBox").classList.toggle("hidden", mode !== "login");
  $("registerBox").classList.toggle("hidden", mode !== "register");
  $("loginTab").classList.toggle("active", mode === "login");
  $("registerTab").classList.toggle("active", mode === "register");
}

async function login() {
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        name: $("loginName").value,
        password: $("loginPassword").value
      })
    });
    authToken = data.token;
    localStorage.setItem(TOKEN_KEY, authToken);
    me = data.user;
    await enterApp();
  } catch (err) {
    toast(err.message);
  }
}

async function register() {
  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: $("registerName").value,
        password: $("registerPassword").value,
        password_confirm: $("registerPasswordConfirm").value
      })
    });
    authToken = data.token;
    localStorage.setItem(TOKEN_KEY, authToken);
    me = data.user;
    await enterApp();
  } catch (err) {
    toast(err.message);
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch (_) {}
  authToken = "";
  me = null;
  state = null;
  localStorage.removeItem(TOKEN_KEY);
  $("landing").classList.remove("hidden");
  $("home").classList.add("hidden");
}

async function autoBoot() {
  try {
    config = await api("/api/config");
  } catch (_) {}
  if (!authToken) return;
  try {
    const data = await api("/api/me");
    me = data.user;
    await enterApp();
  } catch (_) {
    localStorage.removeItem(TOKEN_KEY);
    authToken = "";
  }
}

async function enterApp() {
  $("landing").classList.add("hidden");
  $("home").classList.remove("hidden");
  updateChrome();
  await loadState();
  setView("forYou");
}

async function loadState() {
  try {
    state = await api("/api/social/state");
    me = state.profile || me;
    profileDraft = {
      display_name: me?.display_name || me?.name || "",
      about: me?.about || ""
    };
    updateChrome();
    render();
  } catch (err) {
    toast(err.message);
  }
}

function updateChrome() {
  $("meName").textContent = me?.display_name || me?.name || "Usuario";
  const el = $("meAvatar");
  if (!el) return;
  const url = me?.avatar_url || "";
  el.textContent = url ? "" : initials(me);
  el.className = `avatar ${url ? "has-image" : ""}`;
  el.style.backgroundImage = url ? `url('${url}')` : "";
}

function setView(view) {
  currentView = view || "forYou";
  document.querySelectorAll(".nav").forEach(btn => btn.classList.toggle("active", btn.dataset.view === currentView));
  document.querySelectorAll(".view").forEach(el => el.classList.add("hidden"));
  const active = $(`${currentView}View`);
  if (active) active.classList.remove("hidden");
  const titles = {
    forYou: "For You",
    profile: "Meu perfil",
    users: "Perfis",
    campaigns: "Campanhas",
    sheets: "Minhas fichas",
    tools: "Ferramentas",
    settings: "Configuracoes"
  };
  $("pageTitle").textContent = titles[currentView] || "Main";
  render();
}

function socialState() {
  return state || { profile: me || {}, friends: [], campaigns: [], notifications: [], sheets: [], tools: [] };
}

function render() {
  renderForYou();
  renderProfile();
  renderUsers();
  renderCampaigns();
  renderSheets();
  renderTools();
  renderSettings();
}

function renderForYou() {
  const s = socialState();
  const campaigns = s.campaigns || [];
  const friends = s.friends || [];
  const notifications = s.notifications || [];
  const sheets = s.sheets || [];
  const next = campaigns[0];
  $("forYouView").innerHTML = `
    <section class="home-grid">
      <aside class="profile-rail">
        <article class="card profile-card">
          <div class="cover"></div>
          <div class="profile-head">${avatar(s.profile, "large")}<div><strong>${escapeHtml(s.profile?.display_name || s.profile?.name || "Usuario")}</strong><small>@${escapeHtml(s.profile?.name || "conta")}</small></div></div>
          <p>${escapeHtml(s.profile?.about || "Seu espaco principal no Chamas RPG.")}</p>
          <div class="stats">
            <span><strong>${campaigns.length}</strong> campanhas</span>
            <span><strong>${friends.length}</strong> perfis</span>
            <span><strong>${sheets.length}</strong> fichas</span>
          </div>
        </article>
      </aside>
      <main class="feed">
        <article class="card action-card">
          <div><p class="eyebrow">For You</p><h3>Area principal</h3><small>Continue sua mesa ou abra uma ferramenta.</small></div>
          <div class="actions">
            <button class="primary" onclick="setView('campaigns')">Campanhas</button>
            <button onclick="setView('sheets')">Minhas fichas</button>
            <button onclick="setView('tools')">Ferramentas</button>
          </div>
        </article>
        <article class="card post">
          <div class="post-head">${avatar(s.profile)}<div><strong>${next ? escapeHtml(next.name) : "Comece uma mesa"}</strong><small>${notifications.length ? `${notifications.length} aviso(s)` : "Sem avisos pendentes"}</small></div></div>
          <p>${next ? `Campanha com ${next.members.length} membro(s).` : "Crie uma campanha, adicione perfis e escolha uma ficha principal."}</p>
          <div class="actions"><button onclick="setView('campaigns')">Ver campanhas</button><button onclick="setView('users')">Perfis</button></div>
        </article>
        <article class="card tool-card">
          <div class="symbol">MX</div>
          <div><p class="eyebrow">Ferramenta</p><h3>Mixer separado</h3><p>Audio, biblioteca e Discord ficam no app do Mixer.</p><button onclick="openMixer()">Abrir Mixer</button></div>
        </article>
      </main>
    </section>
  `;
}

function renderProfile() {
  const profile = socialState().profile || {};
  $("profileView").innerHTML = `
    <section class="page narrow">
      <article class="card profile-card">
        <div class="cover"></div>
        <div class="profile-head">${avatar(profile, "large")}<div><strong>${escapeHtml(profile.display_name || profile.name || "Usuario")}</strong><small>@${escapeHtml(profile.name || "conta")}</small></div></div>
        <p>${escapeHtml(profile.about || "Sem descricao ainda.")}</p>
      </article>
      <article class="card">
        <p class="eyebrow">Home do perfil</p>
        <h3>Presenca na mesa</h3>
        <p>Este e o perfil que seus amigos veem em campanhas e convites.</p>
        <div class="actions"><button onclick="setView('settings')">Editar perfil</button><button onclick="setView('campaigns')">Campanhas</button></div>
      </article>
    </section>
  `;
}

function renderUsers() {
  const friends = socialState().friends || [];
  $("usersView").innerHTML = `
    <section class="page narrow">
      <article class="card">
        <p class="eyebrow">Perfis</p>
        <h3>Adicionar pessoa</h3>
        <div class="inline-form"><input id="friendNameInput" placeholder="Nome / apelido exato" value="${escapeHtml(friendDraft)}" oninput="friendDraft=this.value"><button class="primary" onclick="addFriend()">Adicionar</button></div>
      </article>
      <div class="feed single">
        ${friends.length ? friends.map(friend => `
          <article class="card post">
            <div class="post-head">${avatar(friend)}<div><strong>${escapeHtml(friend.display_name || friend.name)}</strong><small>@${escapeHtml(friend.name)}</small></div></div>
            <p>${escapeHtml(friend.about || "Perfil adicionado para campanhas.")}</p>
            <div class="actions"><button onclick="setView('campaigns')">Convidar</button><button class="ghost" onclick="removeFriend('${escapeJs(friend.id)}')">Remover</button></div>
          </article>
        `).join("") : `<article class="empty">Nenhum perfil adicionado ainda.</article>`}
      </div>
    </section>
  `;
}

function renderCampaigns() {
  const s = socialState();
  const campaigns = s.campaigns || [];
  const friends = s.friends || [];
  const sheets = s.sheets || [];
  $("campaignsView").innerHTML = `
    <section class="page">
      <article class="card">
        <p class="eyebrow">Campanhas</p>
        <h3>Organize uma mesa</h3>
        <div class="inline-form"><input id="campaignNameInput" placeholder="Nome da campanha" value="${escapeHtml(campaignDraft)}" oninput="campaignDraft=this.value"><button class="primary" onclick="createCampaign()">Criar</button></div>
      </article>
      <div class="grid-list">
        ${campaigns.length ? campaigns.map(campaign => `
          <article class="card campaign">
            <div class="campaign-head"><div><p class="eyebrow">${campaign.is_owner ? "Mestre" : "Membro"}</p><h3>${escapeHtml(campaign.name)}</h3><small>Dono: ${escapeHtml(campaign.owner?.display_name || campaign.owner_name || "Mestre")}</small></div><span class="badge">${escapeHtml(campaign.role || "jogador")}</span></div>
            <div class="chips">${(campaign.members || []).map(member => `<span>${avatar(member)} ${escapeHtml(member.display_name || member.name)}</span>`).join("")}</div>
            <label>Ficha principal</label>
            ${campaign.can_manage ? `<select onchange="setCampaignSheet('${escapeJs(campaign.id)}', this.value)">${sheets.map(sheet => `<option value="${escapeHtml(sheet.id)}" ${sheet.id === campaign.main_sheet_id ? "selected" : ""}>${escapeHtml(sheet.name)}</option>`).join("")}</select>` : `<strong>${escapeHtml(campaign.main_sheet?.name || "Sem ficha")}</strong>`}
            <div class="actions"><a class="button-link primary" href="${escapeHtml(campaign.main_sheet?.url || "#")}" target="_blank" rel="noopener">Abrir ficha</a></div>
            ${campaign.can_manage ? `<div class="inline-form"><select onchange="inviteDrafts['${escapeJs(campaign.id)}']=this.value"><option value="">Adicionar perfil...</option>${friends.filter(friend => !(campaign.member_ids || []).map(String).includes(String(friend.id))).map(friend => `<option value="${escapeHtml(friend.id)}">${escapeHtml(friend.display_name || friend.name)}</option>`).join("")}</select><button onclick="inviteCampaign('${escapeJs(campaign.id)}')">Adicionar</button></div>` : ""}
          </article>
        `).join("") : `<article class="empty">Nenhuma campanha ainda.</article>`}
      </div>
    </section>
  `;
}

function renderSheets() {
  const sheets = socialState().sheets || [];
  $("sheetsView").innerHTML = `
    <section class="page">
      <article class="card">
        <p class="eyebrow">Minhas fichas</p>
        <h3>Modelos disponiveis</h3>
        <p>Esta main aponta para os modelos atuais. Depois eles podem morar completamente neste app.</p>
      </article>
      <div class="grid-list">
        ${sheets.map(sheet => `
          <article class="card sheet">
            <p class="eyebrow">${escapeHtml(sheet.system)}</p>
            <h3>${escapeHtml(sheet.name)}</h3>
            <p>${escapeHtml(sheet.description)}</p>
            <a class="button-link primary" href="${escapeHtml(sheet.url)}" target="_blank" rel="noopener">Abrir</a>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderTools() {
  const tools = socialState().tools || [];
  $("toolsView").innerHTML = `
    <section class="page narrow">
      ${tools.map(tool => `
        <article class="card tool-card">
          <div class="symbol">${escapeHtml(tool.id === "mixer" ? "MX" : "TL")}</div>
          <div><p class="eyebrow">Ferramenta</p><h3>${escapeHtml(tool.name)}</h3><p>${escapeHtml(tool.description)}</p><button class="primary" onclick="window.open('${escapeJs(tool.url)}','_blank','noopener')">Abrir</button></div>
        </article>
      `).join("")}
    </section>
  `;
}

function renderSettings() {
  const profile = socialState().profile || {};
  $("settingsView").innerHTML = `
    <section class="page narrow">
      <article class="card">
        <p class="eyebrow">Configuracoes</p>
        <h3>Conta e perfil</h3>
        <div class="settings-grid">
          <div>${avatar(profile, "large")}</div>
          <div>
            <label>Nome do perfil</label>
            <input id="profileDisplayName" value="${escapeHtml(profileDraft.display_name || profile.display_name || profile.name || "")}" oninput="profileDraft.display_name=this.value">
            <label>Sobre mim</label>
            <textarea id="profileAbout" oninput="profileDraft.about=this.value">${escapeHtml(profileDraft.about || profile.about || "")}</textarea>
          </div>
        </div>
        <div class="actions">
          <label class="file-button">Foto<input type="file" accept="image/png,image/jpeg,image/webp" onchange="uploadAvatar(this.files && this.files[0])"></label>
          <button class="ghost" onclick="removeAvatar()">Remover foto</button>
          <button class="primary" onclick="saveProfile()">Salvar</button>
        </div>
      </article>
    </section>
  `;
}

async function saveProfile() {
  try {
    state = await api("/api/profile", {
      method: "POST",
      body: JSON.stringify(profileDraft)
    });
    toast("Perfil salvo.");
    render();
  } catch (err) {
    toast(err.message);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Nao consegui ler a imagem."));
    reader.readAsDataURL(file);
  });
}

async function uploadAvatar(file) {
  if (!file) return;
  try {
    const avatar_url = await readFileAsDataUrl(file);
    const data = await api("/api/profile/avatar", {
      method: "POST",
      body: JSON.stringify({ avatar_url })
    });
    me = data.user;
    await loadState();
    toast("Foto atualizada.");
  } catch (err) {
    toast(err.message);
  }
}

async function removeAvatar() {
  try {
    await api("/api/profile/avatar", { method: "POST", body: JSON.stringify({ avatar_url: "" }) });
    await loadState();
    toast("Foto removida.");
  } catch (err) {
    toast(err.message);
  }
}

async function addFriend() {
  try {
    state = await api("/api/friends", { method: "POST", body: JSON.stringify({ name: friendDraft }) });
    friendDraft = "";
    toast("Perfil adicionado.");
    render();
  } catch (err) {
    toast(err.message);
  }
}

async function removeFriend(id) {
  try {
    state = await api(`/api/friends/${id}`, { method: "DELETE" });
    toast("Perfil removido.");
    render();
  } catch (err) {
    toast(err.message);
  }
}

async function createCampaign() {
  try {
    state = await api("/api/campaigns", { method: "POST", body: JSON.stringify({ name: campaignDraft || "Nova campanha" }) });
    campaignDraft = "";
    toast("Campanha criada.");
    render();
  } catch (err) {
    toast(err.message);
  }
}

async function inviteCampaign(campaignId) {
  const user_id = inviteDrafts[campaignId] || "";
  if (!user_id) return toast("Escolha um perfil.");
  try {
    state = await api(`/api/campaigns/${campaignId}/invite`, { method: "POST", body: JSON.stringify({ user_id }) });
    inviteDrafts[campaignId] = "";
    toast("Perfil adicionado a campanha.");
    render();
  } catch (err) {
    toast(err.message);
  }
}

async function setCampaignSheet(campaignId, sheetId) {
  try {
    state = await api(`/api/campaigns/${campaignId}/sheet`, { method: "POST", body: JSON.stringify({ sheet_id: sheetId }) });
    toast("Ficha atualizada.");
    render();
  } catch (err) {
    toast(err.message);
  }
}

function openMixer() {
  window.open(config.mixer_public_url || "https://chamas-mixer.shardweb.app", "_blank", "noopener");
}

document.addEventListener("DOMContentLoaded", () => {
  $("loginBtn").addEventListener("click", login);
  $("registerBtn").addEventListener("click", register);
  $("logoutBtn").addEventListener("click", logout);
  ["loginName", "loginPassword"].forEach(id => $(id).addEventListener("keydown", event => { if (event.key === "Enter") login(); }));
  ["registerName", "registerPassword", "registerPasswordConfirm"].forEach(id => $(id).addEventListener("keydown", event => { if (event.key === "Enter") register(); }));
  document.querySelectorAll(".nav").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));
  autoBoot();
});
