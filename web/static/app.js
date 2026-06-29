const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "chamas_main_token";
const FEED_CACHE_PREFIX = "chamas_main_mock_feed_";
const FEED_INTERVAL_MS = 60 * 1000;

let authToken = localStorage.getItem(TOKEN_KEY) || "";
let me = null;
let state = null;
let config = { mixer_public_url: "https://chamas-mixer.shardweb.app" };
let currentView = "forYou";
let profileDraft = { display_name: "", about: "" };
let friendDraft = "";
let campaignDraft = "";
let inviteDrafts = {};
let searchQuery = "";
let feedPosts = [];
let feedUserId = "";
let feedSeedCursor = 0;
let feedIntervalId = null;

const BOT_PROFILES = [
  {
    id: "bot-kara",
    name: "kara.bot",
    display_name: "Kara Curadora",
    about: "Organiza os destaques do feed, puxa momentos fortes da mesa e empurra o que esta quente para o topo.",
    role: "bot",
    badge: "BOT",
    specialty: "Curadoria do feed",
    status: "Publicando resumos a cada 1 min",
    community: "c/for-you",
  },
  {
    id: "bot-nyx",
    name: "nyx.bot",
    display_name: "Nyx Vigia",
    about: "Observa atividade de campanhas, detecta convites e mantem o pulso social da mesa sempre em movimento.",
    role: "bot",
    badge: "BOT",
    specialty: "Monitor de campanhas",
    status: "Rastreando mesas ativas",
    community: "c/campanhas",
  },
  {
    id: "bot-orin",
    name: "orin.bot",
    display_name: "Orin Arquivista",
    about: "Destaca fichas, sistemas e templates com cara de biblioteca viva para o grupo achar tudo rapido.",
    role: "bot",
    badge: "BOT",
    specialty: "Biblioteca de fichas",
    status: "Separando fichas e modelos",
    community: "c/fichas",
  },
  {
    id: "bot-vexa",
    name: "vexa.bot",
    display_name: "Vexa Operadora",
    about: "Cuida das automacoes leves e faz a ponte visual entre a Main e o Mixer sem embaralhar dominios.",
    role: "bot",
    badge: "BOT",
    specialty: "Ferramentas e Mixer",
    status: "Sincronizando apps e atalhos",
    community: "c/funcoes",
  },
];

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.add("hidden"), 2800);
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

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matchesSearch(...values) {
  const query = normalizeText(searchQuery);
  if (!query) return true;
  return values.some((value) => normalizeText(value).includes(query));
}

function initials(user) {
  const text = (user?.display_name || user?.name || "CM").trim();
  return text.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
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
  feedPosts = [];
  feedUserId = "";
  searchQuery = "";
  clearInterval(feedIntervalId);
  feedIntervalId = null;
  localStorage.removeItem(TOKEN_KEY);
  if ($("mainSearch")) $("mainSearch").value = "";
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
    ensureFeedSession();
    updateChrome();
    render();
  } catch (err) {
    toast(err.message);
  }
}

function updateChrome() {
  const displayName = me?.display_name || me?.name || "Usuario";
  const handle = `@${me?.name || "conta"}`;
  const roleLabel = me?.role === "developer" ? "Developer na mesa" : "Pronto para a proxima sessao";
  const avatarMarkup = initials(me);
  const url = me?.avatar_url || "";

  $("meName").textContent = displayName;
  $("meHandle").textContent = handle;
  $("sidebarName").textContent = displayName;
  $("sidebarRole").textContent = roleLabel;

  const avatarNodes = [$("meAvatar"), $("sidebarAvatar")];
  avatarNodes.forEach((node) => {
    if (!node) return;
    node.textContent = url ? "" : avatarMarkup;
    node.className = `avatar ${url ? "has-image" : ""}`;
    node.style.backgroundImage = url ? `url('${url}')` : "";
  });

  $("mainSubtitle").textContent = `${feedPosts.length || 0} posts no feed`;
}

function setView(view) {
  currentView = view || "forYou";
  document.querySelectorAll(".nav").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === currentView);
  });
  document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
  const active = $(`${currentView}View`);
  if (active) active.classList.remove("hidden");
  const titles = {
    forYou: "For You",
    profile: "Meu perfil",
    users: "Perfis",
    campaigns: "Campanhas",
    sheets: "Minhas fichas",
    tools: "Funcoes",
    settings: "Configuracoes"
  };
  const summaries = {
    forYou: "Acompanhe posts, campanhas, fichas e bots em um feed central.",
    profile: "Sua identidade de mesa, atividade recente e atalhos sociais.",
    users: "Perfis reais e bots de exemplo para povoar a comunidade.",
    campaigns: "Mesas organizadas como comunidades, com membros e ficha principal.",
    sheets: "Biblioteca visual de modelos e atalhos para abrir cada ficha.",
    tools: "Aplicativos e funcoes conectadas ao ecossistema do Chamas.",
    settings: "Edite conta, avatar e texto publico do perfil."
  };
  $("pageTitle").textContent = titles[currentView] || "Main";
  $("pageSummary").textContent = summaries[currentView] || "Navegue pela timeline principal do Chamas.";
  render();
}

function socialState() {
  return state || { profile: me || {}, friends: [], campaigns: [], notifications: [], sheets: [], tools: [] };
}

function slugify(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "mesa";
}

function formatRelativeTime(createdAt) {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - Number(createdAt || 0)) / 1000));
  if (diffSeconds < 45) return "agora";
  if (diffSeconds < 3600) return `${Math.max(1, Math.floor(diffSeconds / 60))} min`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} h`;
  return `${Math.floor(diffSeconds / 86400)} d`;
}

function feedCacheKey() {
  return `${FEED_CACHE_PREFIX}${me?.id || "guest"}`;
}

function loadFeedCache() {
  try {
    const raw = localStorage.getItem(feedCacheKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean);
  } catch (_) {
    return [];
  }
}

function saveFeedCache() {
  if (!me?.id) return;
  try {
    localStorage.setItem(feedCacheKey(), JSON.stringify(feedPosts.slice(0, 40)));
  } catch (_) {}
}

function ensureFeedSession() {
  if (!me?.id) return;
  if (feedUserId !== me.id) {
    feedUserId = me.id;
    const cached = loadFeedCache();
    feedPosts = cached.length ? cached : seedFeedPosts();
  } else if (!feedPosts.length) {
    feedPosts = seedFeedPosts();
  }

  saveFeedCache();

  if (!feedIntervalId) {
    feedIntervalId = window.setInterval(() => {
      const post = generateAutomatedPost();
      feedPosts.unshift(post);
      feedPosts = feedPosts.slice(0, 40);
      saveFeedCache();
      updateChrome();
      if (currentView === "forYou") {
        renderForYou();
      } else {
        toast(`Novo post no feed: ${post.title}`);
      }
    }, FEED_INTERVAL_MS);
  }
}

function seedFeedPosts() {
  feedSeedCursor = 0;
  const offsets = [55, 18, 11, 7, 4, 2].map((minutes) => minutes * 60 * 1000);
  return offsets.map((offsetMs) => generateAutomatedPost({ offsetMs })).sort((a, b) => b.created_at - a.created_at);
}

function pickBot(index = 0) {
  return BOT_PROFILES[index % BOT_PROFILES.length];
}

function buildPostFromTemplate(templateIndex, offsetMs = 0) {
  const s = socialState();
  const campaigns = s.campaigns || [];
  const sheets = s.sheets || [];
  const friends = s.friends || [];
  const primaryCampaign = campaigns[templateIndex % Math.max(1, campaigns.length)] || campaigns[0] || null;
  const fallbackCampaignName = primaryCampaign?.name || "Nova Mesa Chamas";
  const fallbackSheetName = primaryCampaign?.main_sheet?.name || sheets[templateIndex % Math.max(1, sheets.length)]?.name || "Ficha basica em branco";
  const bot = pickBot(templateIndex);

  const templates = [
    () => ({
      author: bot,
      community: primaryCampaign ? `c/${slugify(primaryCampaign.name)}` : "c/for-you",
      kind: "Mesa",
      title: primaryCampaign ? `${primaryCampaign.name} entrou no radar da timeline` : "Comece sua primeira campanha social",
      body: primaryCampaign
        ? `${bot.display_name} marcou a mesa como ativa: ${primaryCampaign.members.length} membro(s), ficha ${fallbackSheetName} e clima pronto para a proxima sessao.`
        : `${bot.display_name} preparou a area principal para voce criar uma mesa, puxar fichas e montar o primeiro ritmo do feed.`,
      score: 31 + templateIndex * 3,
      comments: 4 + templateIndex,
      cta_label: primaryCampaign ? "Abrir campanhas" : "Criar campanha",
      cta_view: "campaigns",
      tags: primaryCampaign ? ["mesa ativa", "campanha"] : ["onboarding", "for-you"]
    }),
    () => ({
      author: bot,
      community: "c/fichas",
      kind: "Ficha",
      title: `${fallbackSheetName} ganhou destaque de biblioteca`,
      body: `${bot.display_name} colocou essa ficha entre os acessos rapidos do feed para facilitar testes, ajustes de build e preparacao de personagem.`,
      score: 22 + templateIndex * 2,
      comments: 2 + templateIndex,
      cta_label: "Ver fichas",
      cta_view: "sheets",
      tags: ["ficha", "biblioteca"]
    }),
    () => ({
      author: bot,
      community: "c/perfis",
      kind: "Perfil",
      title: friends.length
        ? `Seu circulo social cresceu para ${friends.length} perfil(is)`
        : "Adicione perfis para dar cara de comunidade a sua mesa",
      body: friends.length
        ? `${bot.display_name} encontrou perfis em comum e sugeriu convites para futuras mesas, mantendo a timeline mais parecida com rede social.`
        : `${bot.display_name} abriu espaco para bots e perfis de exemplo. Assim o layout continua vivo mesmo antes de voce chamar o grupo real.`,
      score: 15 + templateIndex * 2,
      comments: 1 + templateIndex,
      cta_label: "Abrir perfis",
      cta_view: "users",
      tags: ["social", "perfis"]
    }),
    () => ({
      author: bot,
      community: "c/funcoes",
      kind: "App",
      title: "Mixer continua como ferramenta, mas agora conversa com o feed",
      body: `${bot.display_name} deixou um atalho pronto para o Mixer sem puxar audio, Discord e cenas para dentro da Main. O shell social continua leve.`,
      score: 27 + templateIndex * 2,
      comments: 3 + templateIndex,
      cta_label: "Abrir funcoes",
      cta_view: "tools",
      tags: ["mixer", "funcoes"]
    }),
    () => ({
      author: bot,
      community: primaryCampaign ? `c/${slugify(primaryCampaign.name)}` : "c/campanhas",
      kind: "Resumo",
      title: primaryCampaign ? `${primaryCampaign.name} recebeu um resumo automatico` : "Seu feed ja esta pronto para resumos automaticos",
      body: primaryCampaign
        ? `${bot.display_name} consolidou membros, dono da mesa e ficha principal em uma publicacao rapida para deixar a home mais parecida com mural social.`
        : `${bot.display_name} vai continuar soltando posts a cada 1 min para povoar a experiencia enquanto voce monta a comunidade real.`,
      score: 18 + templateIndex * 4,
      comments: 2 + templateIndex,
      cta_label: "Ver For You",
      cta_view: "forYou",
      tags: ["resumo", "timeline"]
    }),
  ];

  const selected = templates[templateIndex % templates.length]();
  return {
    id: `feed_${Date.now()}_${templateIndex}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: Date.now() - offsetMs,
    ...selected,
  };
}

function generateAutomatedPost(options = {}) {
  const post = buildPostFromTemplate(feedSeedCursor, Number(options.offsetMs || 0));
  feedSeedCursor += 1;
  return post;
}

function visibleFeedPosts() {
  return feedPosts.filter((post) => matchesSearch(
    post.title,
    post.body,
    post.community,
    post.kind,
    post.author?.display_name,
    (post.tags || []).join(" ")
  ));
}

function visibleBots() {
  return BOT_PROFILES.filter((bot) => matchesSearch(
    bot.display_name,
    bot.name,
    bot.about,
    bot.specialty,
    bot.community
  ));
}

function visibleFriends() {
  return (socialState().friends || []).filter((friend) => matchesSearch(
    friend.display_name,
    friend.name,
    friend.about
  ));
}

function visibleCampaigns() {
  return (socialState().campaigns || []).filter((campaign) => matchesSearch(
    campaign.name,
    campaign.owner?.display_name,
    campaign.main_sheet?.name,
    (campaign.members || []).map((member) => member.display_name || member.name).join(" ")
  ));
}

function visibleSheets() {
  return (socialState().sheets || []).filter((sheet) => matchesSearch(
    sheet.name,
    sheet.system,
    sheet.description
  ));
}

function spotlightBot(botId) {
  const bot = BOT_PROFILES.find((item) => item.id === botId);
  if (!bot) return;
  searchQuery = bot.display_name;
  if ($("mainSearch")) $("mainSearch").value = bot.display_name;
  setView("forYou");
  toast(`Mostrando o feed de ${bot.display_name}.`);
}

function clearSearch() {
  searchQuery = "";
  if ($("mainSearch")) $("mainSearch").value = "";
  render();
}

function openTool(url) {
  window.open(url, "_blank", "noopener");
}

function render() {
  updateChrome();
  renderForYou();
  renderProfile();
  renderUsers();
  renderCampaigns();
  renderSheets();
  renderTools();
  renderSettings();
}

function renderStories() {
  const campaigns = socialState().campaigns || [];
  const stories = [
    {
      title: "Resumo vivo",
      text: "Kara solta novos destaques no feed a cada 1 min.",
      action: "Ver feed",
      onclick: "clearSearch(); setView('forYou')"
    },
    {
      title: "Mesa em foco",
      text: campaigns[0] ? `A campanha ${campaigns[0].name} esta puxando o ritmo.` : "Crie sua primeira mesa e ela entra no mural.",
      action: "Campanhas",
      onclick: "setView('campaigns')"
    },
    {
      title: "Bots ativos",
      text: `${BOT_PROFILES.length} bots de exemplo mantem o layout vivo.`,
      action: "Perfis",
      onclick: "setView('users')"
    },
    {
      title: "Mixer conectado",
      text: "A Main segue leve e chama o Mixer como app externo.",
      action: "Funcoes",
      onclick: "setView('tools')"
    }
  ];

  return stories.map((story) => `
    <article class="story-card">
      <small>${escapeHtml(story.title)}</small>
      <strong>${escapeHtml(story.text)}</strong>
      <button type="button" onclick="${story.onclick}">${escapeHtml(story.action)}</button>
    </article>
  `).join("");
}

function renderFeedPost(post) {
  return `
    <article class="panel feed-post ${post.kind === "Mesa" ? "post-emphasis" : ""}">
      <div class="post-top">
        <div class="post-identity">
          ${avatar(post.author)}
          <div>
            <strong>${escapeHtml(post.author?.display_name || "Bot")}</strong>
            <small>${escapeHtml(post.community)} . ${escapeHtml(formatRelativeTime(post.created_at))}</small>
          </div>
        </div>
        <span class="post-badge">${escapeHtml(post.kind)}</span>
      </div>
      <h3>${escapeHtml(post.title)}</h3>
      <p>${escapeHtml(post.body)}</p>
      <div class="post-tags">
        ${(post.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
      </div>
      <div class="post-footer">
        <button type="button">${post.score} reacoes</button>
        <button type="button">${post.comments} comentarios</button>
        ${post.cta_view ? `<button type="button" class="primary" onclick="setView('${escapeJs(post.cta_view)}')">${escapeHtml(post.cta_label || "Abrir")}</button>` : ""}
      </div>
    </article>
  `;
}

function renderForYou() {
  const s = socialState();
  const campaigns = s.campaigns || [];
  const sheets = s.sheets || [];
  const notifications = s.notifications || [];
  const posts = visibleFeedPosts();
  const bots = visibleBots();

  $("forYouView").innerHTML = `
    <section class="social-grid">
      <main class="feed-column">
        <article class="panel composer-shell">
          <div class="composer-head">
            ${avatar(s.profile)}
            <div>
              <strong>${escapeHtml(s.profile?.display_name || s.profile?.name || "Usuario")}</strong>
              <small>O feed recebe posts automaticos a cada 1 min com bots de exemplo.</small>
            </div>
          </div>
          <button class="composer-trigger" type="button" onclick="setView('campaigns')">Comecar por uma campanha, ficha ou destaque do grupo</button>
          <div class="composer-actions">
            <button type="button" onclick="setView('campaigns')">Nova campanha</button>
            <button type="button" onclick="setView('sheets')">Abrir fichas</button>
            <button type="button" onclick="setView('users')">Ver perfis</button>
          </div>
        </article>

        <section class="story-strip">
          ${renderStories()}
        </section>

        <article class="panel feed-toolbar">
          <div>
            <p class="eyebrow">Pulso do feed</p>
            <strong>${posts.length} publicacoes visiveis</strong>
          </div>
          <div class="toolbar-actions">
            ${searchQuery ? `<button type="button" onclick="clearSearch()">Limpar busca</button>` : ""}
            <button type="button" onclick="loadState()">Atualizar estado</button>
          </div>
        </article>

        ${posts.map(renderFeedPost).join("") || `<article class="panel empty-state">Nenhum post encontrou a busca atual.</article>`}
      </main>

      <aside class="feed-rail">
        <article class="panel profile-card">
          <div class="cover-band"></div>
          <div class="profile-chip">
            ${avatar(s.profile, "large")}
            <div>
              <strong>${escapeHtml(s.profile?.display_name || s.profile?.name || "Usuario")}</strong>
              <small>@${escapeHtml(s.profile?.name || "conta")}</small>
            </div>
          </div>
          <p>${escapeHtml(s.profile?.about || "Seu perfil principal para a timeline da mesa.")}</p>
          <div class="stat-grid">
            <span><strong>${campaigns.length}</strong> mesas</span>
            <span><strong>${sheets.length}</strong> fichas</span>
            <span><strong>${notifications.length}</strong> avisos</span>
          </div>
          <button type="button" class="primary full" onclick="setView('profile')">Ver perfil</button>
        </article>

        <article class="panel rail-list">
          <div class="rail-head">
            <p class="eyebrow">Campanhas em alta</p>
            <button type="button" onclick="setView('campaigns')">Ver tudo</button>
          </div>
          ${campaigns.slice(0, 3).map((campaign) => `
            <div class="rail-item">
              <strong>${escapeHtml(campaign.name)}</strong>
              <small>${escapeHtml(campaign.owner?.display_name || campaign.owner_name || "Mestre")} . ${campaign.members.length} membro(s)</small>
            </div>
          `).join("") || `<div class="rail-item muted">Ainda nao existe campanha no radar.</div>`}
        </article>

        <article class="panel rail-list">
          <div class="rail-head">
            <p class="eyebrow">Bots ativos</p>
            <button type="button" onclick="setView('users')">Perfis</button>
          </div>
          ${bots.slice(0, 3).map((bot) => `
            <button type="button" class="bot-mini" onclick="spotlightBot('${escapeJs(bot.id)}')">
              <span>${escapeHtml(bot.display_name)}</span>
              <small>${escapeHtml(bot.specialty)}</small>
            </button>
          `).join("")}
        </article>
      </aside>
    </section>
  `;
}

function renderProfile() {
  const s = socialState();
  const profile = s.profile || {};
  const campaigns = visibleCampaigns();
  const friends = visibleFriends();
  const relatedPosts = visibleFeedPosts().slice(0, 4);

  $("profileView").innerHTML = `
    <section class="profile-layout">
      <main class="profile-main">
        <article class="panel profile-hero">
          <div class="cover-band cover-large"></div>
          <div class="profile-hero-row">
            ${avatar(profile, "hero")}
            <div class="profile-hero-copy">
              <h3>${escapeHtml(profile.display_name || profile.name || "Usuario")}</h3>
              <small>@${escapeHtml(profile.name || "conta")}</small>
              <p>${escapeHtml(profile.about || "Atualize o perfil para dar mais cara de rede social a sua timeline.")}</p>
            </div>
            <button type="button" onclick="setView('settings')">Editar perfil</button>
          </div>
        </article>

        <article class="panel">
          <div class="section-title">
            <div>
              <p class="eyebrow">Atividade</p>
              <h3>Timeline recente</h3>
            </div>
            <button type="button" onclick="setView('forYou')">Ver feed</button>
          </div>
          <div class="timeline-list">
            ${relatedPosts.map((post) => `
              <div class="timeline-item">
                <strong>${escapeHtml(post.title)}</strong>
                <small>${escapeHtml(post.community)} . ${escapeHtml(formatRelativeTime(post.created_at))}</small>
              </div>
            `).join("") || `<div class="empty-state">Nenhuma atividade recente para mostrar.</div>`}
          </div>
        </article>

        <article class="panel">
          <div class="section-title">
            <div>
              <p class="eyebrow">Mesas</p>
              <h3>Campanhas em que voce aparece</h3>
            </div>
            <button type="button" onclick="setView('campaigns')">Abrir campanhas</button>
          </div>
          <div class="community-grid compact-grid">
            ${campaigns.map((campaign) => `
              <article class="community-card">
                <strong>${escapeHtml(campaign.name)}</strong>
                <small>${campaign.members.length} membro(s) . ${escapeHtml(campaign.main_sheet?.name || "Sem ficha")}</small>
              </article>
            `).join("") || `<div class="empty-state">Nenhuma campanha ligada ao perfil ainda.</div>`}
          </div>
        </article>
      </main>

      <aside class="profile-side">
        <article class="panel">
          <p class="eyebrow">Resumo</p>
          <div class="stat-grid">
            <span><strong>${campaigns.length}</strong> campanhas</span>
            <span><strong>${friends.length}</strong> perfis</span>
            <span><strong>${feedPosts.length}</strong> posts</span>
          </div>
        </article>
        <article class="panel rail-list">
          <p class="eyebrow">Atalhos</p>
          <button type="button" onclick="setView('users')">Perfis</button>
          <button type="button" onclick="setView('sheets')">Fichas</button>
          <button type="button" onclick="setView('tools')">Funcoes</button>
        </article>
      </aside>
    </section>
  `;
}

function renderPersonCard(person, options = {}) {
  const isBot = !!options.isBot;
  const primaryAction = isBot
    ? `<button type="button" onclick="spotlightBot('${escapeJs(person.id)}')">Ver no feed</button>`
    : `<button type="button" onclick="setView('campaigns')">Convidar</button>`;
  const secondaryAction = isBot
    ? `<button type="button" class="ghost" onclick="setView('forYou')">Acompanhar</button>`
    : `<button type="button" class="ghost" onclick="removeFriend('${escapeJs(person.id)}')">Remover</button>`;

  return `
    <article class="panel person-card ${isBot ? "bot-card" : ""}">
      <div class="person-top">
        ${avatar(person, "large")}
        <div>
          <div class="person-title">
            <strong>${escapeHtml(person.display_name || person.name)}</strong>
            ${isBot ? `<span class="bot-badge">${escapeHtml(person.badge || "BOT")}</span>` : ""}
          </div>
          <small>@${escapeHtml(person.name || "perfil")}</small>
        </div>
      </div>
      <p>${escapeHtml(person.about || (isBot ? "Bot de exemplo sem bio." : "Perfil sem descricao."))}</p>
      <div class="person-meta">
        <span>${escapeHtml(isBot ? person.specialty : "Perfil social")}</span>
        <span>${escapeHtml(isBot ? person.community : person.role || "jogador")}</span>
      </div>
      <div class="card-actions">
        ${primaryAction}
        ${secondaryAction}
      </div>
    </article>
  `;
}

function renderUsers() {
  const bots = visibleBots();
  const friends = visibleFriends();

  $("usersView").innerHTML = `
    <section class="stack-layout">
      <article class="panel wide-panel">
        <div class="section-title">
          <div>
            <p class="eyebrow">Perfis</p>
            <h3>Adicionar pessoa real</h3>
          </div>
        </div>
        <div class="inline-form">
          <input id="friendNameInput" placeholder="Nome ou apelido exato" value="${escapeHtml(friendDraft)}" oninput="friendDraft=this.value">
          <button type="button" class="primary" onclick="addFriend()">Adicionar</button>
        </div>
      </article>

      <section class="split-section">
        <div class="section-title">
          <div>
            <p class="eyebrow">Bots ativos</p>
            <h3>Perfis de exemplo</h3>
          </div>
        </div>
        <div class="people-grid">
          ${bots.map((bot) => renderPersonCard(bot, { isBot: true })).join("")}
        </div>
      </section>

      <section class="split-section">
        <div class="section-title">
          <div>
            <p class="eyebrow">Perfis reais</p>
            <h3>Sua rede</h3>
          </div>
        </div>
        <div class="people-grid">
          ${friends.map((friend) => renderPersonCard(friend)).join("") || `<article class="panel empty-state">Nenhum perfil real adicionado ainda.</article>`}
        </div>
      </section>
    </section>
  `;
}

function renderCampaignCard(campaign, friends, sheets) {
  return `
    <article class="panel community-card full-card">
      <div class="community-head">
        <div>
          <p class="eyebrow">${campaign.is_owner ? "Mestre" : "Membro"}</p>
          <h3>${escapeHtml(campaign.name)}</h3>
          <small>Dono: ${escapeHtml(campaign.owner?.display_name || campaign.owner_name || "Mestre")}</small>
        </div>
        <span class="community-badge">${escapeHtml(campaign.role || "jogador")}</span>
      </div>

      <div class="chip-row">
        ${(campaign.members || []).map((member) => `<span>${avatar(member)} ${escapeHtml(member.display_name || member.name)}</span>`).join("")}
      </div>

      <label>Ficha principal</label>
      ${campaign.can_manage
        ? `<select onchange="setCampaignSheet('${escapeJs(campaign.id)}', this.value)">${sheets.map((sheet) => `<option value="${escapeHtml(sheet.id)}" ${sheet.id === campaign.main_sheet_id ? "selected" : ""}>${escapeHtml(sheet.name)}</option>`).join("")}</select>`
        : `<strong>${escapeHtml(campaign.main_sheet?.name || "Sem ficha")}</strong>`}

      <div class="card-actions">
        <a class="button-link primary" href="${escapeHtml(campaign.main_sheet?.url || "#")}" target="_blank" rel="noopener">Abrir ficha</a>
        <button type="button" onclick="setView('forYou')">Ver no feed</button>
      </div>

      ${campaign.can_manage ? `
        <div class="inline-form">
          <select onchange="inviteDrafts['${escapeJs(campaign.id)}']=this.value">
            <option value="">Adicionar perfil...</option>
            ${friends
              .filter((friend) => !(campaign.member_ids || []).map(String).includes(String(friend.id)))
              .map((friend) => `<option value="${escapeHtml(friend.id)}">${escapeHtml(friend.display_name || friend.name)}</option>`)
              .join("")}
          </select>
          <button type="button" onclick="inviteCampaign('${escapeJs(campaign.id)}')">Adicionar</button>
        </div>
      ` : ""}
    </article>
  `;
}

function renderCampaigns() {
  const s = socialState();
  const campaigns = visibleCampaigns();
  const friends = s.friends || [];
  const sheets = s.sheets || [];

  $("campaignsView").innerHTML = `
    <section class="stack-layout">
      <article class="panel wide-panel">
        <div class="section-title">
          <div>
            <p class="eyebrow">Campanhas</p>
            <h3>Crie uma comunidade nova</h3>
          </div>
          <small>As mesas ficam com cara de grupo, feed proprio e ficha principal em destaque.</small>
        </div>
        <div class="inline-form">
          <input id="campaignNameInput" placeholder="Nome da campanha" value="${escapeHtml(campaignDraft)}" oninput="campaignDraft=this.value">
          <button type="button" class="primary" onclick="createCampaign()">Criar</button>
        </div>
      </article>

      <div class="community-grid">
        ${campaigns.map((campaign) => renderCampaignCard(campaign, friends, sheets)).join("") || `<article class="panel empty-state">Nenhuma campanha encontrada para a busca atual.</article>`}
      </div>
    </section>
  `;
}

function renderSheets() {
  const sheets = visibleSheets();
  const highlightedPost = visibleFeedPosts().find((post) => (post.tags || []).includes("ficha"));

  $("sheetsView").innerHTML = `
    <section class="social-grid alt-grid">
      <main class="feed-column">
        <article class="panel wide-panel">
          <div class="section-title">
            <div>
              <p class="eyebrow">Biblioteca</p>
              <h3>Modelos disponiveis</h3>
            </div>
            <small>Os modelos ainda podem apontar para o Mixer, mas a vitrine social agora mora aqui.</small>
          </div>
        </article>

        <div class="library-grid">
          ${sheets.map((sheet) => `
            <article class="panel sheet-card">
              <p class="eyebrow">${escapeHtml(sheet.system)}</p>
              <h3>${escapeHtml(sheet.name)}</h3>
              <p>${escapeHtml(sheet.description)}</p>
              <div class="card-actions">
                <a class="button-link primary" href="${escapeHtml(sheet.url)}" target="_blank" rel="noopener">Abrir ficha</a>
                <button type="button" onclick="setView('campaigns')">Usar em campanha</button>
              </div>
            </article>
          `).join("")}
        </div>
      </main>

      <aside class="feed-rail">
        <article class="panel rail-list">
          <p class="eyebrow">Destaque do feed</p>
          <strong>${escapeHtml(highlightedPost?.title || "Nenhuma ficha em destaque agora")}</strong>
          <small>${escapeHtml(highlightedPost?.body || "Os bots vao trazer fichas para o mural automaticamente.")}</small>
        </article>
      </aside>
    </section>
  `;
}

function renderTools() {
  const tools = socialState().tools || [];

  $("toolsView").innerHTML = `
    <section class="stack-layout">
      <article class="panel wide-panel">
        <div class="section-title">
          <div>
            <p class="eyebrow">Funcoes</p>
            <h3>Apps conectados ao ecossistema</h3>
          </div>
          <small>A Main fica social. O resto entra como ferramenta especializada.</small>
        </div>
      </article>

      <div class="apps-grid">
        ${tools.map((tool) => `
          <article class="panel app-card">
            <div class="app-icon">${escapeHtml(tool.id === "mixer" ? "MX" : "TL")}</div>
            <div>
              <p class="eyebrow">App externo</p>
              <h3>${escapeHtml(tool.name)}</h3>
              <p>${escapeHtml(tool.description)}</p>
            </div>
            <div class="card-actions">
              <button type="button" class="primary" onclick="openTool('${escapeJs(tool.url)}')">Abrir</button>
              <button type="button" onclick="setView('forYou')">Voltar ao feed</button>
            </div>
          </article>
        `).join("")}

        <article class="panel app-card">
          <div class="app-icon">BOT</div>
          <div>
            <p class="eyebrow">Mock social</p>
            <h3>Bots de exemplo</h3>
            <p>Perfis simulados para manter a home com ritmo de comunidade enquanto o backend social amadurece.</p>
          </div>
          <div class="card-actions">
            <button type="button" class="primary" onclick="setView('users')">Ver perfis</button>
            <button type="button" onclick="setView('forYou')">Ver posts</button>
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderSettings() {
  const profile = socialState().profile || {};

  $("settingsView").innerHTML = `
    <section class="settings-layout">
      <article class="panel settings-card">
        <div class="section-title">
          <div>
            <p class="eyebrow">Configuracoes</p>
            <h3>Conta e identidade</h3>
          </div>
        </div>

        <div class="settings-grid">
          <div class="settings-summary">
            ${avatar(profile, "hero")}
            <strong>${escapeHtml(profile.display_name || profile.name || "Usuario")}</strong>
            <small>@${escapeHtml(profile.name || "conta")}</small>
            <p>Seu texto e avatar aparecem na timeline, no perfil e nos cards laterais.</p>
          </div>

          <div class="settings-form">
            <label>Nome do perfil</label>
            <input id="profileDisplayName" value="${escapeHtml(profileDraft.display_name || profile.display_name || profile.name || "")}" oninput="profileDraft.display_name=this.value">
            <label>Sobre mim</label>
            <textarea id="profileAbout" oninput="profileDraft.about=this.value">${escapeHtml(profileDraft.about || profile.about || "")}</textarea>
            <div class="card-actions">
              <label class="file-button">Foto<input type="file" accept="image/png,image/jpeg,image/webp" onchange="uploadAvatar(this.files && this.files[0])"></label>
              <button type="button" class="ghost" onclick="removeAvatar()">Remover foto</button>
              <button type="button" class="primary" onclick="saveProfile()">Salvar</button>
            </div>
          </div>
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
  $("mainSearch").addEventListener("input", (event) => {
    searchQuery = event.target.value || "";
    render();
  });
  ["loginName", "loginPassword"].forEach((id) => $(id).addEventListener("keydown", (event) => {
    if (event.key === "Enter") login();
  }));
  ["registerName", "registerPassword", "registerPasswordConfirm"].forEach((id) => $(id).addEventListener("keydown", (event) => {
    if (event.key === "Enter") register();
  }));
  document.querySelectorAll(".nav").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));
  autoBoot();
});
