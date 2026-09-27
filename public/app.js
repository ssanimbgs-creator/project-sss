(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const LOGIN_NAME_KEY = "lovenest:name";
  const CLIENT_ID_KEY = "lovenest:client-id";
  const CHAT_SEEN_PREFIX = "lovenest:chat-seen:";

  const QUESTIONS = [
    "What tiny thing I do always makes you smile?",
    "If we could be anywhere together tonight, where would you take us?",
    "What is a little moment with me you wish you could bottle up?",
    "What song feels like it belongs to us?",
    "When do you feel most understood by me?",
    "What would our perfect slow Sunday look like?",
    "What is something new you would love for us to try?",
    "What was your first little clue that you liked me?",
    "What is your favourite ordinary day we have shared?",
    "What place should we add to our future-adventure list?",
    "What is one thing about us that you hope never changes?",
    "What nickname would you give our love story?",
    "What meal should we make together next?",
    "What is a way I make life feel softer for you?",
    "If our relationship had a season, which one would it be?",
    "What is your favourite way for us to spend a quiet evening?",
    "What little tradition should we start just for us?",
    "What is something you are looking forward to doing together?",
    "What colour reminds you of us, and why?",
    "What memory of us makes you feel warm every time?",
    "What is one thing you would like us to learn together?",
    "If we had a surprise free day, how should we spend it?",
    "What is the kindest thing someone has ever done for you?",
    "What do you admire about the way we care for each other?",
    "What would our little home smell like on a rainy day?",
    "What is a dream of yours I can help cheer on?",
    "Which little adventure of ours would you happily repeat?",
    "What is your favourite way to say 'I love you' without words?",
    "What should our next celebration be, even if there is no occasion?",
    "What do you hope future-us remembers about right now?",
  ];

  const ROUNDS = [
    ["A moonlit walk", "A blanket fort and a film"],
    ["Sunrise together", "A slow midnight conversation"],
    ["A little cabin in the woods", "A weekend by the sea"],
    ["Cook something new", "Order all our favourites"],
    ["A handwritten letter", "A voice note out of nowhere"],
    ["Dance in the kitchen", "Make a playlist for each other"],
    ["A tiny road trip", "A cosy day with nowhere to be"],
    ["Stargaze until we get sleepy", "Watch the rain from inside"],
    ["A museum date", "A bookshop and a coffee"],
    ["Revisit our first date", "Plan a day we've never had before"],
    ["Matching little souvenirs", "A photo from an ordinary Tuesday"],
    ["Breakfast in bed", "Dessert before dinner"],
  ];

  let savedClientId = localStorage.getItem(CLIENT_ID_KEY);
  if (!savedClientId || !/^[a-zA-Z0-9-]{12,80}$/.test(savedClientId)) {
    savedClientId = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, savedClientId);
  }

  const state = {
    socket: null,
    roomId: null,
    cryptoKey: null,
    clientId: savedClientId,
    name: "",
    roster: [],
    events: [],
    knownEventIds: new Set(),
    activeView: "home",
    selectedColor: "#b96373",
    pendingStroke: null,
    activeCall: null,
    incomingCall: null,
    localStream: null,
    player: null,
    playerReadyId: null,
    suppressMusicUntil: 0,
    queuedIce: [],
    toastTimer: null,
    unreadChatCount: 0,
    memoryFilter: "all",
    memoryYear: "all",
    pendingMemoryPhoto: null,
    memoryPhotoProcessing: false,
    memoryPhotoJobId: 0,
    memoryPage: 0,
    memoryPhotoData: new Map(),
    memoryPhotoLoads: new Map(),
    activePhotoId: null,
    loadingHistory: false,
    historyQueue: Promise.resolve(),
  };

  const viewNames = {
    home: "Our space",
    chat: "Little chats",
    letters: "Love letters",
    memories: "Our memories",
    music: "Listen together",
    questions: "Question jar",
    game: "Little games",
    drawing: "Doodle sky",
    stars: "Our constellation",
  };

  const loginForm = $("#join-form");
  const nameInput = $("#name-input");
  const secretInput = $("#secret-input");
  const loginError = $("#login-error");
  const joinButton = $("#join-button");
  const loginScreen = $("#login-screen");
  const appShell = $("#app-shell");
  const viewRoot = $("#view-root");
  const toastNode = $("#toast");
  const callModal = $("#call-modal");
  const remoteAudio = $("#remote-audio");
  const photoLightbox = $("#photo-lightbox");
  const lightboxImage = $("#lightbox-image");
  const lightboxCaption = $("#lightbox-caption");

  nameInput.value = localStorage.getItem(LOGIN_NAME_KEY) || "";

  $(".reveal-secret").addEventListener("click", (event) => {
    const visible = secretInput.type === "text";
    secretInput.type = visible ? "password" : "text";
    event.currentTarget.setAttribute("aria-label", visible ? "Show secret word" : "Hide secret word");
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.hidden = true;
    const name = nameInput.value.trim().slice(0, 28);
    const secret = secretInput.value.normalize("NFKC").trim().toLowerCase();
    if (!name || secret.length < 4) {
      showLoginError("Add your name and a secret word of at least four characters.");
      return;
    }
    if (!window.crypto?.subtle || !window.isSecureContext) {
      showLoginError("This private room needs a secure connection. Open it on localhost or use an HTTPS address.");
      return;
    }
    if (typeof window.io !== "function") {
      showLoginError("The room server could not be reached. Start LoveNest, then try again.");
      return;
    }

    joinButton.disabled = true;
    $("#join-button span:first-child").textContent = "Opening your space…";
    try {
      const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "PBKDF2", false, ["deriveKey", "deriveBits"]);
      const roomBits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: encoder.encode("LoveNest room id v1"), iterations: 310_000, hash: "SHA-256" },
        material,
        256
      );
      const roomId = [...new Uint8Array(roomBits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const contentBits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: encoder.encode("LoveNest private content v1"), iterations: 310_000, hash: "SHA-256" },
        material,
        256
      );
      const cryptoKey = await crypto.subtle.importKey("raw", contentBits, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await connectRoom({ name, roomId, cryptoKey });
    } catch (error) {
      showLoginError(error?.message || "Something went wrong opening your room. Please try again.");
    } finally {
      joinButton.disabled = false;
      $("#join-button span:first-child").textContent = "Enter our space";
    }
  });

  function showLoginError(message) {
    loginError.textContent = message;
    loginError.hidden = false;
  }

  function connectRoom({ name, roomId, cryptoKey }) {
    state.socket?.disconnect();
    const socket = window.io({
      autoConnect: false,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      timeout: 12_000,
    });
    state.socket = socket;
    state.name = name;
    state.roomId = roomId;
    state.cryptoKey = cryptoKey;
    state.events = [];
    state.knownEventIds.clear();
    state.roster = [];
    state.memoryPhotoJobId += 1;
    state.memoryPhotoProcessing = false;
    state.pendingMemoryPhoto = null;
    state.memoryFilter = "all";
    state.memoryYear = "all";
    state.memoryPage = 0;
    state.memoryPhotoData.clear();
    state.memoryPhotoLoads.clear();
    state.loadingHistory = false;
    state.historyQueue = Promise.resolve();

    const joinPromise = new Promise((resolve, reject) => {
      let hasJoined = false;
      let initialConnectionSettled = false;
      const failInitialJoin = (message) => {
        if (initialConnectionSettled) return;
        initialConnectionSettled = true;
        window.clearTimeout(initialTimer);
        socket.disconnect();
        if (state.socket === socket) state.socket = null;
        reject(new Error(message));
      };
      const initialTimer = window.setTimeout(() => {
        failInitialJoin("The room server took too long to answer. Please try again.");
      }, 18_000);

      socket.on("connect", () => {
        state.loadingHistory = true;
        socket.emit("join-room", { roomId, name, clientId: state.clientId }, (response) => {
          if (!response?.ok) {
            const message = response?.error || "Could not join that space.";
            if (!hasJoined) failInitialJoin(message);
            else showToast(message);
            return;
          }
          state.roster = response.members || [];
          if (hasJoined) { updatePresence(); return; }
          hasJoined = true;
          initialConnectionSettled = true;
          window.clearTimeout(initialTimer);
          localStorage.setItem(LOGIN_NAME_KEY, name);
          loginScreen.hidden = true;
          appShell.hidden = false;
          if (!state.loadingHistory) render();
          updatePresence();
          showToast("You’re in. Your little space is ready.");
          resolve();
        });
      });
      socket.on("connect_error", () => {
        if (hasJoined) showToast("Trying to find your little space again…");
        else failInitialJoin("Couldn't reach LoveNest. Check that the server is running, then try again.");
      });
    });
    socket.on("disconnect", () => {
      updatePresence();
      if (!appShell.hidden) showToast("The connection paused. Reconnecting…");
    });
    socket.on("room-history", (message) => {
      const history = Array.isArray(message) ? message : (Array.isArray(message?.events) ? message.events : []);
      const complete = Array.isArray(message) || message?.complete === true;
      state.loadingHistory = true;
      state.historyQueue = state.historyQueue.then(async () => {
        for (const roomEvent of history) await receiveEvent(roomEvent);
        if (complete) { state.loadingHistory = false; render(); }
      }).catch(() => {
        state.loadingHistory = false;
        showToast("Some older memories could not be loaded.");
        render();
      });
    });
    socket.on("room-event", (roomEvent) => { receiveEvent(roomEvent); });
    socket.on("room-presence", (members) => {
      state.roster = Array.isArray(members) ? members : [];
      updatePresence();
      renderHomeStatus();
    });
    socket.on("call-incoming", onIncomingCall);
    socket.on("call-response", onCallResponse);
    socket.on("call-signal", onCallSignal);
    socket.connect();
    return joinPromise;
  }

  async function encryptPayload(payload, key = state.cryptoKey) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const encoded = encoder.encode(JSON.stringify(payload));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, encoded);
    return JSON.stringify({ v: 1, n: bytesToBase64(nonce), c: bytesToBase64(new Uint8Array(encrypted)) });
  }

  async function decryptPayload(packet, key = state.cryptoKey) {
    try {
      const parsed = JSON.parse(packet);
      if (parsed?.v !== 1 || typeof parsed.n !== "string" || typeof parsed.c !== "string") return null;
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(parsed.n) },
        key,
        base64ToBytes(parsed.c)
      );
      const payload = JSON.parse(decoder.decode(plain));
      return payload && typeof payload.type === "string" ? payload : null;
    } catch {
      return null;
    }
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function postEvent(payload, attachmentPayload = null) {
    if (!state.socket?.connected || !state.cryptoKey) {
      showToast("Your room is reconnecting. Try again in a moment.");
      return false;
    }
    const socket = state.socket;
    const cryptoKey = state.cryptoKey;
    try {
      const packet = await encryptPayload(payload, cryptoKey);
      const attachment = attachmentPayload ? await encryptPayload(attachmentPayload, cryptoKey) : undefined;
      if (state.socket !== socket || state.cryptoKey !== cryptoKey || !socket.connected) {
        showToast("Your room changed before this could be saved. Please try again.");
        return false;
      }
      socket.emit("room-event", { packet, attachment });
      return true;
    } catch {
      showToast("This little note could not be sent. Please try again.");
      return false;
    }
  }

  async function loadMemoryPhoto(event) {
    if (state.memoryPhotoData.has(event.id)) return state.memoryPhotoData.get(event.id);
    if (state.memoryPhotoLoads.has(event.id)) return state.memoryPhotoLoads.get(event.id);
    if (!state.socket?.connected || event.payload.hasPhoto !== true) throw new Error("This photo is not available right now.");
    const socket = state.socket;
    const cryptoKey = state.cryptoKey;
    const load = new Promise((resolve, reject) => {
      socket.timeout(15_000).emit("get-room-attachment", { eventId: event.id }, async (error, response) => {
        if (error) { reject(new Error("This photo could not be loaded. Check your connection and try again.")); return; }
        if (state.socket !== socket) { reject(new Error("This photo is no longer available in this room.")); return; }
        if (!response?.ok || typeof response.packet !== "string") { reject(new Error("This photo could not be loaded.")); return; }
        const payload = await decryptPayload(response.packet, cryptoKey);
        if (payload?.type !== "memory-photo" || typeof payload.dataUrl !== "string" || !payload.dataUrl.startsWith("data:image/jpeg;base64,")) {
          reject(new Error("This photo could not be opened."));
          return;
        }
        state.memoryPhotoData.set(event.id, payload.dataUrl);
        resolve(payload.dataUrl);
      });
    });
    state.memoryPhotoLoads.set(event.id, load);
    try { return await load; }
    finally { state.memoryPhotoLoads.delete(event.id); }
  }

  async function receiveEvent(event) {
    if (!event?.id || state.knownEventIds.has(event.id)) return;
    state.knownEventIds.add(event.id);
    const payload = await decryptPayload(event.packet);
    if (!payload) {
      state.knownEventIds.delete(event.id);
      return;
    }
    state.events.push({ ...event, payload });
    state.events.sort((left, right) => left.createdAt - right.createdAt);
    if (payload.type === "music-state" && event.from !== state.clientId) syncMusic({ ...payload, sentAt: event.createdAt });
    if (state.activeView === "chat" && payload.type === "chat") markChatsSeen();
    if (!state.loadingHistory) {
      if (state.activeView === "drawing" && (payload.type === "draw" || payload.type === "draw-clear")) {
        window.requestAnimationFrame(paintDrawing);
      }
      if (state.activeView === "music" && payload.type === "track") renderMusic();
      else if (state.activeView === "music" && payload.type === "music-state") updateMusicStatus();
      else renderCurrentView();
    }
    updateChatUnread();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function relativeDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) return `today at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function timeLabel(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function eventsOf(type) {
    return state.events.filter((event) => event.payload.type === type);
  }

  function latestOf(type) {
    const events = eventsOf(type);
    return events[events.length - 1] || null;
  }

  function partnerMembers() {
    return state.roster.filter((member) => member.clientId !== state.clientId);
  }

  function partnerName() {
    return partnerMembers()[0]?.name || "your person";
  }

  function initials(name) {
    const parts = String(name || "♡").trim().split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 1)).toLocaleUpperCase();
  }

  function updatePresence() {
    const partner = partnerMembers()[0];
    const nameNode = $("#partner-name-small");
    const statusNode = $("#presence-label");
    const avatar = $("#partner-avatar");
    if (nameNode) nameNode.textContent = partner?.name || "Waiting for your person";
    if (avatar) avatar.textContent = partner ? initials(partner.name) : "♡";
    if (statusNode) {
      statusNode.innerHTML = partner
        ? '<i class="status-dot online"></i> here with you'
        : '<i class="status-dot"></i> waiting to meet you here';
    }
    const youAvatar = $("#you-avatar");
    if (youAvatar) youAvatar.textContent = initials(state.name);
    const callButton = $("#call-button");
    if (callButton) {
      callButton.disabled = !state.socket?.connected || !partner;
      callButton.title = partner ? `Call ${partner.name}` : "Your person needs to be online to call";
    }
  }

  function renderHomeStatus() {
    updatePresence();
    if (state.activeView === "home") renderHome();
  }

  function showToast(message) {
    toastNode.textContent = message;
    toastNode.classList.add("show");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => toastNode.classList.remove("show"), 3200);
  }

  function updateChatUnread() {
    const seen = Number.parseInt(localStorage.getItem(CHAT_SEEN_PREFIX + state.roomId) || "0", 10);
    state.unreadChatCount = state.events.filter((event) => event.payload.type === "chat" && event.from !== state.clientId && event.createdAt > seen).length;
    const badge = $("#chat-count");
    if (badge) {
      badge.textContent = state.unreadChatCount > 9 ? "9+" : String(state.unreadChatCount);
      badge.classList.toggle("visible", state.unreadChatCount > 0);
    }
  }

  function markChatsSeen() {
    const latest = [...state.events].reverse().find((event) => event.payload.type === "chat");
    if (latest) localStorage.setItem(CHAT_SEEN_PREFIX + state.roomId, String(latest.createdAt));
    state.unreadChatCount = 0;
    updateChatUnread();
  }

  function showView(view) {
    if (!viewNames[view]) return;
    state.activeView = view;
    if (view === "chat") markChatsSeen();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function render() {
    $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === state.activeView));
    const crumbTitle = $("#crumb-title");
    if (crumbTitle) crumbTitle.textContent = viewNames[state.activeView];
    const mobileNav = $("#side-nav");
    if (mobileNav) mobileNav.setAttribute("aria-label", `${viewNames[state.activeView]} navigation`);
    renderCurrentView();
    updatePresence();
    updateChatUnread();
  }

  function renderCurrentView(preserveDraft = true) {
    if (!viewRoot || appShell.hidden) return;
    const focused = document.activeElement;
    const draft = preserveDraft && viewRoot.contains(focused) && focused.matches("input, textarea") && focused.name
      ? { kind: focused.form?.dataset.form, name: focused.name, value: focused.value }
      : null;
    const renderer = {
      home: renderHome,
      chat: renderChat,
      letters: renderLetters,
      memories: renderMemories,
      music: renderMusic,
      questions: renderQuestions,
      game: renderGame,
      drawing: renderDrawing,
      stars: renderStars,
    }[state.activeView];
    renderer?.();
    if (draft) {
      const replacement = [...viewRoot.querySelectorAll("input, textarea")].find((field) => field.name === draft.name && field.form?.dataset.form === draft.kind);
      if (replacement) {
        replacement.value = draft.value;
        replacement.focus({ preventScroll: true });
      }
    }
  }

  function renderHome() {
    const now = new Date();
    const letter = [...eventsOf("letter")].reverse()[0];
    const partner = partnerMembers()[0];
    const chatEvents = eventsOf("chat").slice(-5);
    const preview = letter?.payload.text ? escapeHtml(letter.payload.text.slice(0, 128)) + (letter.payload.text.length > 128 ? "…" : "") : "One day, a little note will be waiting here.";
    viewRoot.innerHTML = `
      <div class="home-greeting">
        <div><div class="section-kicker">A SOFTER KIND OF DISTANCE</div><h1>Hello, <em>${escapeHtml(state.name)}</em></h1><p>Your favourite person has a little place here too.</p></div>
        <div class="date-chip">${now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</div>
      </div>
      <section class="hero-card">
        <div class="hero-copy"><div class="section-kicker">A LITTLE HELLO, ANY TIME</div><h2>Good things feel even sweeter shared.</h2><p>Leave a note, send a tiny thought, or make something together. This little corner is yours.</p>
          <div class="hero-actions"><button class="button button-primary" type="button" data-view="chat">Say a little hello <span aria-hidden="true">↗</span></button><button class="button button-ghost" type="button" data-view="questions">Pick a question <span aria-hidden="true">✳</span></button></div>
        </div>
        <div class="hero-planet" aria-hidden="true"><span class="planet-spark spark-a">✦</span><span class="planet-spark spark-b">✧</span><span class="planet-ring"></span><span class="planet-core">♡</span></div>
      </section>
      <div class="home-grid">
        <section class="card home-chat"><div class="card-heading"><div><h3>A little chat</h3><p>Little thoughts, sent across the day.</p></div><button class="subtle-link" type="button" data-view="chat">Open chat ↗</button></div>
          <div id="home-messages" class="message-list">${renderChatRows(chatEvents, true)}</div>
          <form class="message-form" data-form="chat"><input name="message" maxlength="1200" autocomplete="off" placeholder="Send a little hello…" aria-label="Write a chat message" required><button class="send-button" type="submit" aria-label="Send message">↗</button></form>
        </section>
        <div class="home-side">
          <section class="card together-card"><div class="card-heading"><div><h3>Here with you</h3><p>${partner ? `${escapeHtml(partner.name)} has joined your space.` : "When your person arrives, you'll see them here."}</p></div><span class="together-icon">♡</span></div>
            <div class="mini-presence"><i class="status-dot ${partner ? "online" : ""}"></i>${partner ? "Together in your little space" : "Your space is ready for two"}</div>
          </section>
          <section class="last-note-card"><div class="section-kicker">A LITTLE LOVE LETTER</div><p>${preview}</p></section>
        </div>
      </div>
      <div class="quick-row">
        <button class="quick-card" type="button" data-view="letters"><span class="quick-icon">✉</span><span class="quick-copy"><strong>Leave a love note</strong><span>Something just for them</span></span></button>
        <button class="quick-card" type="button" data-view="music"><span class="quick-icon">♫</span><span class="quick-copy"><strong>Press play together</strong><span>Make a little soundtrack</span></span></button>
        <button class="quick-card" type="button" data-view="drawing"><span class="quick-icon">✎</span><span class="quick-copy"><strong>Doodle something</strong><span>A sky you can both share</span></span></button>
        <button class="quick-card" type="button" data-view="memories"><span class="quick-icon">▧</span><span class="quick-copy"><strong>Keep a memory</strong><span>A photo or little story</span></span></button>
      </div>`;
  }

  function renderChatRows(events, compact = false) {
    if (!events.length) return `<div class="empty-note">A small hello can be the loveliest place to start. ♡</div>`;
    return events.map((event) => {
      const mine = event.from === state.clientId;
      const who = mine ? "You" : event.name;
      const avatar = initials(mine ? state.name : event.name);
      return `<article class="chat-row ${mine ? "mine" : ""}"><span class="chat-avatar">${escapeHtml(avatar)}</span><div class="chat-content"><div class="chat-meta">${escapeHtml(who)} · ${timeLabel(event.createdAt)}</div><div class="chat-bubble">${escapeHtml(event.payload.text)}</div></div></article>`;
    }).join("");
  }

  function renderChat() {
    const messages = eventsOf("chat");
    viewRoot.innerHTML = `<section class="chat-page">
      <div class="page-heading"><div><div class="section-kicker">A LITTLE BACK AND FORTH</div><h1>Little chats</h1><p>Ordinary thoughts have a way of making the day feel closer.</p></div><span class="pill">${partnerMembers().length ? `♡ ${escapeHtml(partnerName())} is here` : "♡ Just for the two of you"}</span></div>
      <div class="card full-chat-card"><div class="message-list">${renderChatRows(messages.slice(-120))}</div><form class="message-form" data-form="chat"><input name="message" maxlength="1200" autocomplete="off" placeholder="Write something sweet…" aria-label="Write a chat message" required><button class="send-button" type="submit" aria-label="Send message">↗</button></form><p class="chat-encryption-note">✦ Your messages are private to this room.</p></div>
    </section>`;
    const list = $(".full-chat-card .message-list");
    if (list) list.scrollTop = list.scrollHeight;
  }

  function renderLetters() {
    const letters = [...eventsOf("letter")].reverse();
    viewRoot.innerHTML = `<div class="page-heading"><div><div class="section-kicker">SAVED LITTLE REMINDERS</div><h1>Love letters</h1><p>Write something they can keep and come back to whenever they need it.</p></div></div>
      <div class="letters-layout"><section class="card compose-card"><span class="section-kicker">A NOTE FROM THE HEART</span><h2>Dear ${escapeHtml(partnerName())}…</h2><p>It doesn't have to be perfect. A few honest words are already a gift.</p>
        <form data-form="letter"><textarea name="letter" maxlength="3000" placeholder="I was thinking about you today…" required aria-label="Write a love letter"></textarea><div class="compose-actions"><span class="hint">Only your person can read it ♡</span><button class="button button-primary" type="submit">Save this letter <span>↗</span></button></div></form>
      </section><section class="letters-list" aria-label="Shared love letters">${letters.length ? letters.map((event) => `<article class="letter-card"><div class="letter-topline"><span>♡</span> A letter from ${escapeHtml(event.name)}</div><div class="letter-date">${relativeDate(event.createdAt)}</div><p class="letter-body">${escapeHtml(event.payload.text)}</p></article>`).join("") : `<div class="letter-empty">Your first letter will live here,<br>ready to be read a hundred times over. ♡</div>`}</section></div>`;
  }

  function renderMemories() {
    const allMemories = eventsOf("memory");
    const years = [...new Set(allMemories.map((event) => memoryDateValue(event).slice(0, 4)))].sort((left, right) => right.localeCompare(left));
    if (state.memoryYear !== "all" && !years.includes(state.memoryYear)) state.memoryYear = "all";
    const sorted = [...allMemories].sort((left, right) => {
      const byDay = memoryDateValue(right).localeCompare(memoryDateValue(left));
      return byDay || right.createdAt - left.createdAt;
    });
    const memories = sorted.filter((event) =>
      (state.memoryFilter !== "photos" || event.payload.hasPhoto === true) &&
      (state.memoryYear === "all" || memoryDateValue(event).startsWith(state.memoryYear))
    );
    const photosCount = allMemories.filter((event) => event.payload.hasPhoto === true).length;
    const pageCount = Math.max(1, Math.ceil(memories.length / 24));
    state.memoryPage = Math.min(state.memoryPage, pageCount - 1);
    const firstVisibleIndex = state.memoryPage * 24;
    const visibleMemories = memories.slice(firstVisibleIndex, firstVisibleIndex + 24);
    const visiblePhotoIds = new Set(visibleMemories.filter((event) => event.payload.hasPhoto === true).map((event) => event.id));
    for (const eventId of state.memoryPhotoData.keys()) {
      if (!visiblePhotoIds.has(eventId)) state.memoryPhotoData.delete(eventId);
    }
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    viewRoot.innerHTML = `<div class="page-heading"><div><div class="section-kicker">LITTLE MOMENTS, KEPT CLOSE</div><h1>Our memories</h1><p>A shared album for the moments, photos, and small stories you want to keep.</p></div><span class="pill">${allMemories.length} ${allMemories.length === 1 ? "memory" : "memories"} · ${photosCount} photos</span></div>
      <div class="memories-layout"><section class="card memory-composer"><div class="memory-composer-icon">♡</div><div class="section-kicker">SAVE A MOMENT</div><h2>Keep this one.</h2><p>Add a photo, a little story, or both. It will be here for the two of you.</p>
        <form data-form="memory"><label class="memory-photo-picker" for="memory-photo"><span class="memory-picker-icon">▧</span><span><strong>Add a photo</strong><small>JPG, PNG, or WebP · up to 15 MB</small></span><span class="picker-plus">+</span></label><input class="memory-file-input" id="memory-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a photo for your memory">
          <div id="memory-photo-preview" class="memory-photo-preview" ${state.pendingMemoryPhoto ? "" : "hidden"}><img id="memory-preview-image" alt="Preview of your selected memory photo"><div><span id="memory-preview-name"></span><button class="remove-photo-button" type="button" data-action="remove-memory-photo" aria-label="Remove selected photo">×</button></div></div>
          <label class="memory-field-label" for="memory-caption">A few words to remember it by</label><textarea id="memory-caption" name="caption" maxlength="1200" placeholder="The day we laughed until it got dark…" aria-label="Write a caption for this memory"></textarea>
          <label class="memory-field-label" for="memory-date">When was it?</label><input class="memory-date-input" id="memory-date" name="date" type="date" value="${localDate}" required>
          <button class="button button-primary memory-save-button" type="submit" ${state.memoryPhotoProcessing ? "disabled" : ""}>${state.memoryPhotoProcessing ? "Making your photo smaller…" : "Save this memory"} <span>♡</span></button>
        </form><p class="memory-privacy-note">✦ Your photos are encrypted in this room.</p>
      </section><section class="memory-timeline" aria-label="Your shared memories"><div class="memory-timeline-head"><div><h2>Your little timeline</h2><p>${memories.length ? "All the lovely bits you have kept together." : allMemories.length ? "Nothing matches these filters yet." : "Your shared moments will find a home here."}</p></div><div class="memory-filters"><button class="memory-filter ${state.memoryFilter === "all" ? "active" : ""}" type="button" data-action="memory-filter" data-filter="all">All</button><button class="memory-filter ${state.memoryFilter === "photos" ? "active" : ""}" type="button" data-action="memory-filter" data-filter="photos">Photos</button></div></div>
        <label class="memory-date-filter"><span>Show year</span><select data-action="memory-year-filter" aria-label="Filter memories by year"><option value="all" ${state.memoryYear === "all" ? "selected" : ""}>Every year</option>${years.map((year) => `<option value="${year}" ${state.memoryYear === year ? "selected" : ""}>${year}</option>`).join("")}</select></label>
        ${visibleMemories.length ? visibleMemories.map((event) => {
          const photo = event.payload.hasPhoto === true;
          const photoData = state.memoryPhotoData.get(event.id);
          const caption = String(event.payload.caption || "");
          const label = caption ? `${event.name}: ${caption}` : `${event.name}'s shared photo`;
          const memoryDay = memoryDateValue(event);
          return `<article class="memory-card">${photo ? `<button class="memory-photo-button ${photoData ? "" : "memory-photo-pending"}" type="button" data-memory-photo="${escapeHtml(event.id)}" aria-label="Open photo memory from ${escapeHtml(event.name)}">${photoData ? `<img src="${escapeHtml(photoData)}" alt="${escapeHtml(label)}" loading="lazy">` : `<span class="memory-thumb-loading" aria-hidden="true">♡</span>`}</button>` : `<div class="memory-photo-placeholder" aria-hidden="true"><span>♡</span></div>`}<div class="memory-card-copy"><div class="memory-card-meta"><time datetime="${escapeHtml(memoryDay)}">${formatMemoryDate(memoryDay)}</time><span>saved by ${escapeHtml(event.name)}</span></div>${caption ? `<p>${escapeHtml(caption)}</p>` : `<p class="memory-photo-only">A moment worth keeping. ♡</p>`}</div></article>`;
        }).join("") : `<div class="memory-empty"><span>♡</span><strong>A little space for your favourite moments.</strong><p>Start with a photo from today or write down a memory you both love.</p></div>`}
        ${memories.length > 24 ? `<div class="memory-pagination"><button class="memory-page-button" type="button" data-action="memory-page" data-direction="newer" ${state.memoryPage === 0 ? "disabled" : ""}>← Newer</button><span>Page ${state.memoryPage + 1} of ${pageCount}</span><button class="memory-page-button" type="button" data-action="memory-page" data-direction="older" ${state.memoryPage >= pageCount - 1 ? "disabled" : ""}>Older →</button></div>` : ""}</section></div>`;

    if (state.pendingMemoryPhoto) showMemoryPhotoPreview();
    if (visibleMemories.some((event) => event.payload.hasPhoto === true)) hydrateMemoryThumbnails(visibleMemories);
  }

  async function hydrateMemoryThumbnails(memories) {
    const photoMemories = memories.filter((event) => event.payload.hasPhoto === true && !state.memoryPhotoData.has(event.id));
    for (let start = 0; start < photoMemories.length; start += 4) {
      const batch = photoMemories.slice(start, start + 4);
      await Promise.all(batch.map(async (event) => {
        try {
          const imageData = await loadMemoryPhoto(event);
          const button = $$('[data-memory-photo]', viewRoot).find((node) => node.dataset.memoryPhoto === event.id);
          if (!button) return;
          const image = document.createElement("img");
          image.src = imageData;
          image.alt = event.payload.caption ? `${event.name}: ${event.payload.caption}` : `${event.name}'s shared photo`;
          image.loading = "lazy";
          button.classList.remove("memory-photo-pending", "memory-photo-error");
          button.replaceChildren(image);
        } catch {
          const button = $$('[data-memory-photo]', viewRoot).find((node) => node.dataset.memoryPhoto === event.id);
          if (button) {
            button.classList.add("memory-photo-error");
            const icon = button.querySelector(".memory-thumb-loading");
            if (icon) icon.textContent = "↻";
            button.title = "Photo unavailable. Tap to try again.";
          }
        }
      }));
    }
  }

  function formatMemoryDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
  }

  function memoryDateValue(event) {
    const date = String(event.payload.date || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date(event.createdAt).toISOString().slice(0, 10);
  }

  function showMemoryPhotoPreview() {
    const preview = $("#memory-photo-preview");
    const image = $("#memory-preview-image");
    const fileName = $("#memory-preview-name");
    if (!preview || !image || !fileName || !state.pendingMemoryPhoto) return;
    image.src = state.pendingMemoryPhoto.dataUrl;
    fileName.textContent = state.pendingMemoryPhoto.name;
    preview.hidden = false;
  }

  async function compressMemoryPhoto(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG, or WebP photo.");
    if (file.size > 15 * 1024 * 1024) throw new Error("Choose a photo smaller than 15 MB.");
    const bitmap = await createImageBitmap(file);
    try {
      const scales = [1440, 1200, 1000, 840, 720, 600];
      for (const maxSide of scales) {
        const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * ratio));
        const height = Math.max(1, Math.round(bitmap.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false });
        context.fillStyle = "#fffaf5";
        context.fillRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0, width, height);
        for (const quality of [0.78, 0.68, 0.58, 0.48]) {
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
          if (!blob) continue;
          if (blob.size <= 190_000) {
            const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(new Error("That photo could not be read."));
              reader.readAsDataURL(blob);
            });
            if (typeof dataUrl === "string" && dataUrl.length <= 260_000) return dataUrl;
          }
        }
        canvas.width = 0;
        canvas.height = 0;
      }
    } finally {
      bitmap.close?.();
    }
    throw new Error("That photo is too detailed to save. Try a smaller image.");
  }

  async function showMemoryPhoto(eventId) {
    const memory = state.events.find((event) => event.id === eventId && event.payload.type === "memory");
    if (!memory || memory.payload.hasPhoto !== true) return;
    state.activePhotoId = eventId;
    const caption = String(memory.payload.caption || "");
    lightboxImage.removeAttribute("src");
    lightboxImage.hidden = true;
    lightboxImage.alt = caption || `${memory.name}'s shared photo`;
    lightboxCaption.textContent = caption ? `${memory.name} · ${caption}` : `${memory.name} saved this little moment. ♡`;
    const loading = $("#lightbox-loading");
    loading.textContent = "Opening your memory…";
    loading.hidden = false;
    photoLightbox.hidden = false;
    $("#lightbox-close").focus();
    try {
      const imageData = await loadMemoryPhoto(memory);
      if (state.activePhotoId !== eventId) return;
      lightboxImage.src = imageData;
      lightboxImage.hidden = false;
      loading.hidden = true;
    } catch {
      if (state.activePhotoId === eventId) loading.textContent = "This photo could not be loaded. Check your connection and try again.";
    }
  }

  function hideMemoryPhoto() {
    state.activePhotoId = null;
    photoLightbox.hidden = true;
    lightboxImage.removeAttribute("src");
    lightboxImage.hidden = true;
  }

  function parseTrack(input) {
    let url;
    try { url = new URL(input.trim()); } catch { return null; }
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) {
      let videoId = "";
      if (host === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0] || "";
      else if (url.pathname === "/watch") videoId = url.searchParams.get("v") || "";
      else videoId = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/)?.[1] || "";
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
      return { kind: "youtube", videoId, url: `https://www.youtube.com/watch?v=${videoId}`, label: "A song for the two of you" };
    }
    if (host === "open.spotify.com") {
      const match = url.pathname.match(/^\/(track|album|playlist)\/([A-Za-z0-9]+)\/?$/);
      if (!match) return null;
      return { kind: "spotify", url: `https://open.spotify.com/${match[1]}/${match[2]}`, embed: `https://open.spotify.com/embed/${match[1]}/${match[2]}?utm_source=generator&theme=0`, label: `A little ${match[1]} for the two of you` };
    }
    return null;
  }

  function trackEvent() { return latestOf("track"); }
  function currentTrack() { return trackEvent()?.payload || null; }

  function updateMusicStatus() {
    const badge = $(".player-top .pill");
    if (!badge) return;
    const current = latestOf("music-state")?.payload;
    badge.textContent = current?.state === "playing" ? "♪ in the moment" : "♡ whenever you're ready";
  }

  function renderMusic() {
    const track = currentTrack();
    const isPlaying = latestOf("music-state")?.payload.state === "playing";
    viewRoot.innerHTML = `<div class="page-heading"><div><div class="section-kicker">A TINY SHARED SOUNDTRACK</div><h1>Listen together</h1><p>Put a song in the room and let it keep you company.</p></div><span class="pill">♫ shared room</span></div>
      <div class="music-layout"><section class="card player-card"><div class="player-top"><div><h2>Your listening corner</h2><p>Pick a song; your person will see it here too.</p></div><span class="pill">${isPlaying ? "♪ in the moment" : "♡ whenever you're ready"}</span></div>
        <div id="player-frame" class="player-frame"></div>
        <div class="player-footer"><span class="track-title">${track ? escapeHtml(track.label) : "No song playing just yet"}</span><span class="track-sync">${track?.kind === "youtube" ? "YouTube play and pause sync" : track?.kind === "spotify" ? "Spotify opens in its own player" : "Waiting for a song ♡"}</span></div>
      </section><aside><section class="card track-form-card"><h3>Put a song in the room</h3><p>Paste a YouTube video or Spotify track, album or playlist link.</p><form data-form="track"><input name="track" type="url" maxlength="500" placeholder="https://youtu.be/…" aria-label="YouTube or Spotify link" required><button class="button button-primary" type="submit">Share this song <span>♫</span></button></form><div class="music-tip">A YouTube track will sync its play and pause state. Spotify can play in the shared room, but each person controls their own Spotify player.</div></section></aside></div>`;
    renderMusicPlayer();
  }

  let youtubeScriptPending = false;
  function loadYouTubeApi() {
    if (window.YT?.Player) return Promise.resolve();
    if (youtubeScriptPending) return new Promise((resolve) => {
      const started = Date.now();
      const poll = window.setInterval(() => {
        if (window.YT?.Player || Date.now() - started > 12_000) { window.clearInterval(poll); resolve(); }
      }, 150);
    });
    youtubeScriptPending = true;
    return new Promise((resolve) => {
      const existingCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { existingCallback?.(); resolve(); };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });
  }

  async function renderMusicPlayer() {
    if (state.activeView !== "music") return;
    const frame = $("#player-frame");
    if (!frame) return;
    const event = trackEvent();
    const track = event?.payload;
    if (!track) {
      state.player = null;
      state.playerReadyId = null;
      frame.innerHTML = `<div class="player-empty"><span class="music-note">♫</span><span>A song will sound lovely here.</span></div>`;
      return;
    }
    if (track.kind === "spotify") {
      state.player = null;
      state.playerReadyId = event.id;
      frame.innerHTML = `<iframe class="spotify-embed" src="${escapeHtml(track.embed)}" title="Shared Spotify player" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
      return;
    }
    if (track.kind !== "youtube" || !/^[A-Za-z0-9_-]{11}$/.test(track.videoId)) return;
    if (state.playerReadyId === event.id && state.player) return;
    state.player = null;
    state.playerReadyId = event.id;
    frame.innerHTML = `<div id="yt-player" class="yt-player-wrap"></div>`;
    await loadYouTubeApi();
    if (state.activeView !== "music" || state.playerReadyId !== event.id || !window.YT?.Player || !$("#yt-player")) return;
    state.player = new window.YT.Player("yt-player", {
      width: "100%",
      height: "245",
      videoId: track.videoId,
      host: "https://www.youtube-nocookie.com",
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => {
          const musicState = latestOf("music-state")?.payload;
          if (musicState?.trackId === event.id && musicState.state === "playing") syncMusic({ ...musicState, sentAt: latestOf("music-state")?.createdAt || Date.now() });
        },
        onStateChange: (change) => {
          if (Date.now() < state.suppressMusicUntil || state.playerReadyId !== event.id) return;
          if (change.data === window.YT.PlayerState.PLAYING || change.data === window.YT.PlayerState.PAUSED) {
            const playing = change.data === window.YT.PlayerState.PLAYING;
            const seconds = Math.max(0, Math.floor(state.player?.getCurrentTime?.() || 0));
            postEvent({ type: "music-state", trackId: event.id, state: playing ? "playing" : "paused", seconds, sentAt: Date.now() });
          }
        },
      },
    });
  }

  function syncMusic(musicState) {
    if (musicState.state !== "playing" && musicState.state !== "paused") return;
    const event = trackEvent();
    if (!event || musicState.trackId !== event.id || currentTrack()?.kind !== "youtube") return;
    const attempt = (triesLeft) => {
      if (!state.player || !state.playerReadyId || state.playerReadyId !== event.id || !state.player.getPlayerState) {
        if (triesLeft > 0 && state.activeView === "music") window.setTimeout(() => attempt(triesLeft - 1), 350);
        return;
      }
      const elapsed = musicState.state === "playing" ? Math.max(0, (Date.now() - (musicState.sentAt || Date.now())) / 1000) : 0;
      const targetSeconds = Math.max(0, musicState.seconds + elapsed);
      const currentSeconds = Math.max(0, state.player.getCurrentTime?.() || 0);
      state.suppressMusicUntil = Date.now() + 1800;
      if (Math.abs(currentSeconds - targetSeconds) > 3) state.player.seekTo(targetSeconds, true);
      if (musicState.state === "playing") state.player.playVideo(); else state.player.pauseVideo();
    };
    attempt(14);
  }

  function todayKey() { return new Date().toISOString().slice(0, 10); }
  function dayQuestion() {
    const dayNumber = Math.floor(Date.now() / 86_400_000);
    return QUESTIONS[((dayNumber % QUESTIONS.length) + QUESTIONS.length) % QUESTIONS.length];
  }
  function currentPrompt() {
    const latestPrompt = latestOf("prompt");
    const key = todayKey();
    if (latestPrompt && latestPrompt.payload.day === key) return latestPrompt.payload;
    return { id: `daily-${key}`, day: key, text: dayQuestion() };
  }

  function renderQuestions() {
    const prompt = currentPrompt();
    const replies = eventsOf("response").filter((event) => event.payload.promptId === prompt.id);
    const byPerson = new Map();
    for (const event of replies) byPerson.set(event.from, event);
    const people = new Map([[state.clientId, state.name]]);
    for (const member of partnerMembers()) people.set(member.clientId, member.name);
    const answerCards = [...byPerson.entries()].map(([clientId, event]) => `<div class="answer-card"><strong>${escapeHtml(people.get(clientId) || event.name)} said…</strong><p>${escapeHtml(event.payload.text)}</p></div>`).join("");
    viewRoot.innerHTML = `<div class="page-heading"><div><div class="section-kicker">A LITTLE ROOM FOR THE REAL THINGS</div><h1>Question jar</h1><p>Pick a prompt, take your time, and see what comes up for both of you.</p></div><span class="pill">✳ one good question</span></div>
      <div class="question-layout"><section class="card question-main"><span class="question-orb">✳</span><h2>${escapeHtml(prompt.text)}</h2><p>${replies.length ? "Add your answer, then come back and read each other's." : "There's no wrong answer. Yours can be short, long, or a little bit silly."}</p>
        <form class="response-form" data-form="response" data-prompt-id="${escapeHtml(prompt.id)}" data-prompt-text="${escapeHtml(prompt.text)}"><input name="response" maxlength="800" placeholder="Your answer, in your own words…" aria-label="Your answer" required><button class="button button-primary" type="submit">Save my answer <span>↗</span></button></form>
        ${answerCards ? `<div class="answers">${answerCards}</div>` : `<div class="answer-empty"><span class="waiting-heart">♡</span> Your answers will find their way here.</div>`}</section>
        <aside class="question-side"><section class="card"><h3>Another little prompt</h3><p>Pick something new for both of you to answer. The question will travel to your person too.</p><button class="button button-soft" type="button" data-action="new-question">Pick another question <span>✧</span></button></section><section class="card"><h3>Take it gently</h3><p>You can each answer in your own time. There is no score and no hurry.</p><span class="question-count">${QUESTIONS.length} little questions in the jar ♡</span></section></aside></div>`;
  }

  function renderGame() {
    const roundEvent = latestOf("game-round");
    if (!roundEvent) {
      viewRoot.innerHTML = `<div class="page-heading"><div><div class="section-kicker">NO WRONG ANSWERS, ONLY GOOD STORIES</div><h1>Little games</h1><p>A tiny way to learn a little more about what the other one loves.</p></div><span class="pill">♧ play together</span></div>
        <section class="card game-card game-round-card"><span class="question-orb">♧</span><h2>Ready for a tiny this-or-that?</h2><p class="game-empty">Pick between two lovely possibilities and see if you chose the same thing. Your answers stay tucked away until you've both picked.</p><button class="button button-primary" type="button" data-action="start-game">Start a little round <span>↗</span></button></section>`;
      return;
    }
    const round = roundEvent.payload;
    const answers = eventsOf("game-answer").filter((event) => event.payload.roundId === round.id);
    const byPerson = new Map();
    for (const answer of answers) byPerson.set(answer.from, answer.payload.choice);
    const mine = byPerson.get(state.clientId);
    const partner = partnerMembers()[0];
    const partnerChoice = partner ? byPerson.get(partner.clientId) : undefined;
    const bothAnswered = mine !== undefined && partnerChoice !== undefined;
    const reveal = bothAnswered
      ? `<div class="game-results"><span class="game-result">${escapeHtml(state.name)} picked ${escapeHtml(round[mine])}</span><span class="game-result">${escapeHtml(partner.name)} picked ${escapeHtml(round[partnerChoice])}</span></div><p>${mine === partnerChoice ? "Look at you, thinking alike ♡" : "Different little minds, both lovely answers."}</p>`
      : `<div class="game-results"><span class="game-result">${mine !== undefined ? "Your answer is tucked away ♡" : "Your turn is waiting ♡"}</span>${partnerChoice !== undefined ? `<span class="game-result">${escapeHtml(partner.name)} is ready too</span>` : ""}</div><p>${partner ? "You will both see the answers once you have chosen." : "Your person will see this round when they visit."}</p>`;
    viewRoot.innerHTML = `<div class="page-heading"><div><div class="section-kicker">NO WRONG ANSWERS, ONLY GOOD STORIES</div><h1>Little games</h1><p>A tiny way to learn a little more about what the other one loves.</p></div><button class="button button-soft" type="button" data-action="start-game">New round <span>✧</span></button></div>
      <section class="card game-card game-round-card"><div class="game-topline"><span class="pill">ROUND ${escapeHtml(String(eventsOf("game-round").length))}</span><span class="pill">♡ ${bothAnswered ? "revealed" : "answers tucked away"}</span></div>
        <h2>${escapeHtml(round.question)}</h2><p>Pick your favourite and see if you match.</p><div class="choice-grid">${[0, 1].map((index) => `<button class="choice-button ${mine === index ? "chosen" : ""}" type="button" data-action="game-choice" data-choice="${index}" ${mine !== undefined ? "disabled" : ""}>${escapeHtml(round[index])}</button>`).join("")}</div>${reveal}</section>`;
  }

  const DRAW_COLORS = ["#b96373", "#d28c68", "#dbb658", "#77927d", "#67839c", "#8f78a4", "#4d4749"];
  function renderDrawing() {
    viewRoot.innerHTML = `<div class="page-heading"><div><div class="section-kicker">MAKE A SMALL THING TOGETHER</div><h1>Doodle sky</h1><p>Leave a little mark and your person will see it appear here too.</p></div><span class="pill">✎ made together</span></div>
      <section class="card drawing-card"><div class="drawing-tools">${DRAW_COLORS.map((color, index) => `<button class="draw-color draw-color-${index} ${state.selectedColor === color ? "selected" : ""}" type="button" data-action="draw-color" data-color="${color}" aria-label="Choose drawing colour ${index + 1}" title="Choose this colour"></button>`).join("")}<span class="draw-tools-spacer"></span><button class="button" type="button" data-action="clear-drawing">Clear our sky</button></div>
        <canvas id="drawing-canvas" class="drawing-canvas" aria-label="Shared drawing area. Draw with your finger or mouse."></canvas><p class="drawing-note">Your doodles are tucked safely inside your shared space. ♡</p></section>`;
    setupDrawingCanvas();
  }

  function drawingHistory() {
    return state.events.filter((event) => event.payload.type === "draw" || event.payload.type === "draw-clear");
  }

  function setupDrawingCanvas() {
    const canvas = $("#drawing-canvas");
    if (!canvas) return;
    canvas.addEventListener("pointerdown", (event) => {
      const rectangle = canvas.getBoundingClientRect();
      const point = { x: clamp((event.clientX - rectangle.left) / rectangle.width), y: clamp((event.clientY - rectangle.top) / rectangle.height) };
      state.pendingStroke = { color: state.selectedColor, width: 0.0045, points: [point] };
      canvas.setPointerCapture(event.pointerId);
      paintDrawing();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!state.pendingStroke) return;
      const rectangle = canvas.getBoundingClientRect();
      for (const pointEvent of event.getCoalescedEvents?.() || [event]) {
        if (state.pendingStroke.points.length >= 900) break;
        state.pendingStroke.points.push({ x: clamp((pointEvent.clientX - rectangle.left) / rectangle.width), y: clamp((pointEvent.clientY - rectangle.top) / rectangle.height) });
      }
      paintDrawing();
    });
    const finish = () => {
      if (!state.pendingStroke) return;
      const stroke = state.pendingStroke;
      state.pendingStroke = null;
      if (stroke.points.length) postEvent({ type: "draw", ...stroke });
      paintDrawing();
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    canvas.addEventListener("lostpointercapture", finish);
    window.requestAnimationFrame(paintDrawing);
  }

  function paintDrawing() {
    const canvas = $("#drawing-canvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * scale);
    const height = Math.round(rect.height * scale);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d");
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    for (const event of drawingHistory()) {
      if (event.payload.type === "draw-clear") { context.clearRect(0, 0, rect.width, rect.height); continue; }
      paintStroke(context, event.payload, rect.width, rect.height);
    }
    if (state.pendingStroke) paintStroke(context, state.pendingStroke, rect.width, rect.height);
  }

  function paintStroke(context, stroke, width, height) {
    if (!Array.isArray(stroke.points) || !stroke.points.length) return;
    const size = Math.max(1.5, Math.min(width, height) * Number(stroke.width || 0.0045));
    context.strokeStyle = DRAW_COLORS.includes(stroke.color) ? stroke.color : DRAW_COLORS[0];
    context.fillStyle = context.strokeStyle;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = size;
    context.beginPath();
    const first = stroke.points[0];
    context.moveTo(clamp(first.x) * width, clamp(first.y) * height);
    for (const point of stroke.points.slice(1, 900)) context.lineTo(clamp(point.x) * width, clamp(point.y) * height);
    if (stroke.points.length > 1) context.stroke();
    else { context.beginPath(); context.arc(clamp(first.x) * width, clamp(first.y) * height, size / 2, 0, Math.PI * 2); context.fill(); }
  }

  function renderStars() {
    const stars = eventsOf("star").slice(-24);
    const toolbar = `<div class="constellation-toolbar"><div><div class="section-kicker">A SKY WITH A STORY</div><h1 class="stars-title">Our constellation</h1><p class="stars-description">Add a little star for a moment you want to keep.</p></div><form class="message-form" data-form="star"><input name="star" maxlength="36" placeholder="Name this little star…" aria-label="Name a star" required><button class="send-button" type="submit" aria-label="Add a star">✦</button></form></div>
      <section class="constellation-card"><svg viewBox="0 0 800 344" role="img" aria-label="A constellation of the moments you have shared">${stars.slice(1).map((event, index) => {
        const previous = stars[index].payload;
        const current = event.payload;
        return `<line x1="${Number(previous.x) * 800}" y1="${Number(previous.y) * 344}" x2="${Number(current.x) * 800}" y2="${Number(current.y) * 344}" stroke="rgba(228,204,206,.48)" stroke-width="1" stroke-dasharray="3 5"/>`;
      }).join("")}${stars.map((event) => `<circle cx="${Number(event.payload.x) * 800}" cy="${Number(event.payload.y) * 344}" r="7" fill="rgba(255,237,189,.14)"/><circle cx="${Number(event.payload.x) * 800}" cy="${Number(event.payload.y) * 344}" r="2.8" fill="#fff0c4"/><circle cx="${Number(event.payload.x) * 800}" cy="${Number(event.payload.y) * 344}" r="13" fill="transparent"><title>${escapeHtml(event.payload.label)}</title></circle>`).join("")}</svg>${stars.length ? "" : `<div class="constellation-empty">Every little star will be a moment you chose to keep.<br>Add one together and begin your sky. ♡</div>`}</section>
      <p class="star-caption">${stars.length ? "Every dot is a moment with your own little meaning." : "A quiet sky, waiting for your first shared memory."}</p><div class="star-notes">${stars.map((event) => `<span class="star-note">✦ ${escapeHtml(event.payload.label)}</span>`).join("")}</div>`;
    viewRoot.innerHTML = `<div>${toolbar}</div>`;
  }

  function clamp(value) { return Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0)); }

  async function submitForm(form) {
    const data = new FormData(form);
    const kind = form.dataset.form;
    if (kind === "chat") {
      const text = String(data.get("message") || "").trim().slice(0, 1200);
      if (!text) return;
      if (await postEvent({ type: "chat", text })) { form.reset(); if (state.activeView === "chat") $("input[name='message']", form)?.focus(); }
    } else if (kind === "letter") {
      const text = String(data.get("letter") || "").trim().slice(0, 3000);
      if (!text) return;
      if (await postEvent({ type: "letter", text })) { form.reset(); showToast("Your little letter has been tucked away. ♡"); }
    } else if (kind === "memory") {
      if (state.memoryPhotoProcessing) { showToast("Wait a moment while your photo is prepared."); return; }
      const caption = String(data.get("caption") || "").trim().slice(0, 1200);
      const date = String(data.get("date") || "");
      const imageDataUrl = state.pendingMemoryPhoto?.dataUrl || null;
      if (!caption && !imageDataUrl) { showToast("Add a photo or a few words to keep this memory."); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showToast("Choose a date for this memory."); return; }
      const button = form.querySelector("button[type='submit']");
      if (button) button.disabled = true;
      const sent = await postEvent(
        { type: "memory", date, caption, hasPhoto: Boolean(imageDataUrl) },
        imageDataUrl ? { type: "memory-photo", dataUrl: imageDataUrl } : null
      );
      if (button) button.disabled = false;
      if (sent) {
        state.pendingMemoryPhoto = null;
        state.memoryFilter = "all";
        state.memoryYear = "all";
        form.reset();
        renderMemories();
        showToast("Your memory is tucked away for both of you. ♡");
      }
    } else if (kind === "track") {
      const track = parseTrack(String(data.get("track") || ""));
      if (!track) { showToast("Please use a YouTube video or Spotify track, album, or playlist link."); return; }
      const button = form.querySelector("button[type='submit']");
      if (button) button.disabled = true;
      const sent = await postEvent({ type: "track", ...track });
      if (button) button.disabled = false;
      if (sent) { form.reset(); showToast("Your song is in the room. ♫"); }
    } else if (kind === "response") {
      const text = String(data.get("response") || "").trim().slice(0, 800);
      if (!text) return;
      if (await postEvent({ type: "response", promptId: form.dataset.promptId, prompt: form.dataset.promptText, text })) { form.reset(); showToast("Your answer is saved. ♡"); }
    } else if (kind === "star") {
      const label = String(data.get("star") || "").trim().slice(0, 36);
      if (!label) return;
      if (await postEvent({ type: "star", label, x: 0.12 + Math.random() * 0.76, y: 0.14 + Math.random() * 0.71 })) { form.reset(); showToast("One more little light in your sky. ✦"); }
    }
  }

  viewRoot.addEventListener("change", async (event) => {
    const yearFilter = event.target.closest("[data-action='memory-year-filter']");
    if (yearFilter) {
      state.memoryYear = yearFilter.value;
      state.memoryPage = 0;
      renderMemories();
      return;
    }
    const input = event.target.closest("#memory-photo");
    if (!input || !input.files?.[0]) return;
    const file = input.files[0];
    const jobId = ++state.memoryPhotoJobId;
    state.pendingMemoryPhoto = null;
    state.memoryPhotoProcessing = true;
    const preview = $("#memory-photo-preview");
    if (preview) preview.hidden = true;
    const saveButton = $(".memory-save-button");
    if (saveButton) { saveButton.disabled = true; saveButton.textContent = "Making your photo smaller…"; }
    try {
      const dataUrl = await compressMemoryPhoto(file);
      if (jobId !== state.memoryPhotoJobId || state.activeView !== "memories") return;
      state.pendingMemoryPhoto = { dataUrl, name: file.name.slice(0, 100) };
      showMemoryPhotoPreview();
    } catch (error) {
      if (jobId === state.memoryPhotoJobId) {
        showToast(error?.message || "That photo could not be added.");
        input.value = "";
      }
    } finally {
      if (jobId === state.memoryPhotoJobId) {
        state.memoryPhotoProcessing = false;
        const button = $(".memory-save-button");
        if (button) { button.disabled = false; button.innerHTML = "Save this memory <span>♡</span>"; }
      }
    }
  });

  viewRoot.addEventListener("submit", (event) => {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    submitForm(form);
  });

  viewRoot.addEventListener("click", async (event) => {
    const photoButton = event.target.closest("[data-memory-photo]");
    if (photoButton) { showMemoryPhoto(photoButton.dataset.memoryPhoto); return; }
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) { showView(viewButton.dataset.view); return; }
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton || actionButton.disabled) return;
    const action = actionButton.dataset.action;
    if (action === "memory-filter") {
      state.memoryFilter = actionButton.dataset.filter === "photos" ? "photos" : "all";
      state.memoryPage = 0;
      renderMemories();
    } else if (action === "memory-page") {
      state.memoryPage = Math.max(0, state.memoryPage + (actionButton.dataset.direction === "older" ? 1 : -1));
      renderMemories();
    } else if (action === "remove-memory-photo") {
      state.memoryPhotoJobId += 1;
      state.memoryPhotoProcessing = false;
      state.pendingMemoryPhoto = null;
      const input = $("#memory-photo");
      if (input) input.value = "";
      renderMemories();
    } else if (action === "new-question") {
      const previous = currentPrompt().text;
      const candidates = QUESTIONS.filter((question) => question !== previous);
      const text = candidates[Math.floor(Math.random() * candidates.length)];
      postEvent({ type: "prompt", id: crypto.randomUUID(), day: todayKey(), text });
    } else if (action === "start-game") {
      const current = latestOf("game-round")?.payload.question;
      const candidates = ROUNDS.filter(([left, right]) => `${left} or ${right}?` !== current);
      const [left, right] = candidates[Math.floor(Math.random() * candidates.length)];
      postEvent({ type: "game-round", id: crypto.randomUUID(), question: `${left} or ${right}?`, 0: left, 1: right });
    } else if (action === "game-choice") {
      const round = latestOf("game-round")?.payload;
      if (round) postEvent({ type: "game-answer", roundId: round.id, choice: Number(actionButton.dataset.choice) });
    } else if (action === "draw-color") {
      state.selectedColor = actionButton.dataset.color;
      $$(".draw-color").forEach((button) => button.classList.toggle("selected", button === actionButton));
    } else if (action === "clear-drawing") {
      if (window.confirm("Clear the shared doodle sky? This clears the drawing for both of you.")) postEvent({ type: "draw-clear" });
    }
  });

  $("#side-nav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (button) showView(button.dataset.view);
  });

  $("#leave-button").addEventListener("click", () => {
    if (state.activeCall) closeCall(true, "You left your shared space.");
    if (state.incomingCall) state.socket?.emit("call-response", { to: state.incomingCall.from, callId: state.incomingCall.callId, accepted: false });
    state.incomingCall = null;
    hideCallModal();
    state.socket?.disconnect();
    state.socket = null;
    state.cryptoKey = null;
    state.roomId = null;
    state.events = [];
    state.roster = [];
    state.memoryPhotoJobId += 1;
    state.memoryPhotoProcessing = false;
    state.pendingMemoryPhoto = null;
    state.memoryFilter = "all";
    state.memoryYear = "all";
    state.memoryPage = 0;
    state.memoryPhotoData.clear();
    state.memoryPhotoLoads.clear();
    state.loadingHistory = false;
    state.historyQueue = Promise.resolve();
    hideMemoryPhoto();
    appShell.hidden = true;
    loginScreen.hidden = false;
    secretInput.value = "";
    loginError.hidden = true;
    showToast("Your shared space is tucked away for now.");
  });

  $("#call-button").addEventListener("click", startCallRequest);
  $("#lightbox-close").addEventListener("click", hideMemoryPhoto);
  photoLightbox.addEventListener("click", (event) => { if (event.target === photoLightbox) hideMemoryPhoto(); });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape" && !photoLightbox.hidden) hideMemoryPhoto(); });
  $("#call-close").addEventListener("click", () => {
    if (state.incomingCall && !state.activeCall) {
      state.socket?.emit("call-response", { to: state.incomingCall.from, callId: state.incomingCall.callId, accepted: false });
      state.incomingCall = null;
    }
    if (state.activeCall) closeCall(true);
    else hideCallModal();
  });
  $("#call-decline").addEventListener("click", () => {
    if (state.incomingCall) state.socket?.emit("call-response", { to: state.incomingCall.from, callId: state.incomingCall.callId, accepted: false });
    state.incomingCall = null;
    hideCallModal();
  });
  $("#call-accept").addEventListener("click", acceptIncomingCall);
  $("#call-hangup").addEventListener("click", () => closeCall(true));

  async function startCallRequest() {
    const partner = partnerMembers()[0];
    if (!partner || !state.socket?.connected) { showToast("Your person will need to be here to take a call."); return; }
    if (state.activeCall) { showCallModal(); return; }
    const callId = crypto.randomUUID();
    state.activeCall = { id: callId, remoteSocketId: partner.socketId, role: "caller", connecting: true };
    showCallModal();
    $("#call-kicker").textContent = "CALLING YOUR PERSON";
    $("#call-title").textContent = `Calling ${partner.name}…`;
    $("#call-caption").textContent = "A little hello is on its way.";
    $("#call-avatar").textContent = initials(partner.name);
    $("#call-orbit").classList.add("ringing");
    $("#incoming-actions").hidden = true;
    $("#call-hangup").hidden = false;
    $("#call-note").hidden = false;
    $("#call-note").textContent = "Waiting for an answer ♡";
    state.socket.emit("call-request", { callId });
  }

  function onIncomingCall(call) {
    if (!call?.callId || !call.from || state.activeCall) {
      if (call?.from && call?.callId) state.socket?.emit("call-response", { to: call.from, callId: call.callId, accepted: false });
      return;
    }
    state.incomingCall = call;
    showCallModal();
    $("#call-kicker").textContent = "A LITTLE HELLO FOR YOU";
    $("#call-title").textContent = `${call.name} is calling`;
    $("#call-caption").textContent = "Your person would love to hear your voice.";
    $("#call-avatar").textContent = initials(call.name);
    $("#call-orbit").classList.add("ringing");
    $("#incoming-actions").hidden = false;
    $("#call-hangup").hidden = true;
    $("#call-note").hidden = true;
  }

  async function acceptIncomingCall() {
    const call = state.incomingCall;
    if (!call) return;
    $("#call-accept").disabled = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      state.localStream = stream;
      state.activeCall = { id: call.callId, remoteSocketId: call.from, role: "answerer", pc: null, connecting: true };
      state.incomingCall = null;
      state.socket.emit("call-response", { to: call.from, callId: call.callId, accepted: true });
      await createPeerConnection();
      updateCallInProgress(call.name);
    } catch (error) {
      state.socket?.emit("call-response", { to: call.from, callId: call.callId, accepted: false });
      state.incomingCall = null;
      $("#call-accept").disabled = false;
      $("#call-title").textContent = "Microphone unavailable";
      $("#call-caption").textContent = error?.name === "NotAllowedError" ? "Allow microphone access in your browser, then try again." : "We could not open your microphone on this device.";
      $("#incoming-actions").hidden = true;
      $("#call-note").hidden = false;
      $("#call-note").textContent = "Your person has been told you could not answer.";
    }
  }

  async function onCallResponse(response) {
    if (!state.activeCall || response?.callId !== state.activeCall.id || state.activeCall.role !== "caller") return;
    if (!response.accepted) {
      state.activeCall = null;
      $("#call-kicker").textContent = "JUST YOU TWO";
      $("#call-title").textContent = `${response.name || "Your person"} couldn't answer`;
      $("#call-caption").textContent = "You can leave a little note for them instead.";
      $("#call-orbit").classList.remove("ringing");
      $("#call-hangup").hidden = true;
      $("#call-note").hidden = false;
      $("#call-note").textContent = "Maybe they will call you back soon ♡";
      showToast("Your person couldn't pick up just now.");
      return;
    }
    state.activeCall.remoteSocketId = response.from;
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      await createPeerConnection();
      const offer = await state.activeCall.pc.createOffer();
      await state.activeCall.pc.setLocalDescription(offer);
      sendSignal({ description: state.activeCall.pc.localDescription });
      updateCallInProgress(response.name);
    } catch (error) {
      closeCall(true);
      showToast(error?.name === "NotAllowedError" ? "Allow microphone access to start your call." : "This device could not start the voice call.");
    }
  }

  async function createPeerConnection() {
    if (!state.activeCall) return;
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    state.activeCall.pc = peer;
    for (const track of state.localStream?.getTracks() || []) peer.addTrack(track, state.localStream);
    peer.onicecandidate = (event) => { if (event.candidate && state.activeCall?.pc === peer) sendSignal({ candidate: event.candidate }); };
    peer.ontrack = (event) => {
      if (event.streams?.[0]) remoteAudio.srcObject = event.streams[0];
      remoteAudio.play().catch(() => {});
    };
    peer.onconnectionstatechange = () => {
      const status = peer.connectionState;
      if (status === "connected") {
        if (state.activeCall) state.activeCall.connecting = false;
        $("#call-kicker").textContent = "CONNECTED, JUST YOU TWO";
        $("#call-title").textContent = "Hello, lovely.";
        $("#call-caption").textContent = "Take all the time you need.";
        $("#call-orbit").classList.remove("ringing");
        $("#call-note").textContent = "Your voice is travelling ♡";
      } else if ((status === "failed" || status === "closed") && state.activeCall) {
        closeCall(false);
        showToast("The call ended.");
      }
    };
    if (state.queuedIce.length) {
      const candidates = state.queuedIce.splice(0);
      for (const candidate of candidates) await peer.addIceCandidate(candidate).catch(() => {});
    }
  }

  function sendSignal(data) {
    if (!state.activeCall?.remoteSocketId) return;
    state.socket?.emit("call-signal", { to: state.activeCall.remoteSocketId, callId: state.activeCall.id, data });
  }

  async function onCallSignal(signal) {
    if (signal?.data?.type === "hangup" && state.incomingCall?.callId === signal.callId) {
      state.incomingCall = null;
      hideCallModal();
      showToast("The call has ended.");
      return;
    }
    if (!state.activeCall || signal?.callId !== state.activeCall.id || !signal?.data) return;
    if (signal.data.type === "hangup") {
      closeCall(false);
      showToast("Your person ended the call.");
      return;
    }
    if (signal.data.description?.type === "offer" && state.activeCall.role === "answerer") {
      try {
        await state.activeCall.pc.setRemoteDescription(signal.data.description);
        for (const candidate of state.queuedIce.splice(0)) await state.activeCall.pc.addIceCandidate(candidate).catch(() => {});
        const answer = await state.activeCall.pc.createAnswer();
        await state.activeCall.pc.setLocalDescription(answer);
        sendSignal({ description: state.activeCall.pc.localDescription });
      } catch { closeCall(true); showToast("The voice connection could not be made."); }
    } else if (signal.data.description?.type === "answer" && state.activeCall.role === "caller") {
      try {
        await state.activeCall.pc.setRemoteDescription(signal.data.description);
        for (const candidate of state.queuedIce.splice(0)) await state.activeCall.pc.addIceCandidate(candidate).catch(() => {});
      } catch { closeCall(true); showToast("The voice connection could not be made."); }
    } else if (signal.data.candidate) {
      if (state.activeCall.pc?.remoteDescription) await state.activeCall.pc.addIceCandidate(signal.data.candidate).catch(() => {});
      else state.queuedIce.push(signal.data.candidate);
    }
  }

  function updateCallInProgress(name) {
    $("#call-kicker").textContent = "CONNECTING YOU TWO";
    $("#call-title").textContent = `Calling ${name || "your person"}…`;
    $("#call-caption").textContent = "Just a second while your voices find each other.";
    $("#incoming-actions").hidden = true;
    $("#call-hangup").hidden = false;
    $("#call-orbit").classList.add("ringing");
    $("#call-note").hidden = false;
    $("#call-note").textContent = "Connecting… ♡";
  }

  function showCallModal() { callModal.hidden = false; }
  function hideCallModal() {
    callModal.hidden = true;
    $("#call-orbit").classList.remove("ringing");
    $("#incoming-actions").hidden = true;
    $("#call-hangup").hidden = true;
    $("#call-note").hidden = true;
  }

  function closeCall(shouldSignal = false, toastMessage = "") {
    const call = state.activeCall;
    if (call && shouldSignal) sendSignal({ type: "hangup" });
    if (call?.pc) {
      call.pc.ontrack = null;
      call.pc.onicecandidate = null;
      call.pc.onconnectionstatechange = null;
      call.pc.close();
    }
    for (const track of state.localStream?.getTracks() || []) track.stop();
    state.localStream = null;
    state.activeCall = null;
    state.queuedIce = [];
    remoteAudio.srcObject = null;
    hideCallModal();
    if (toastMessage) showToast(toastMessage);
  }

  window.addEventListener("resize", () => { if (state.activeView === "drawing") paintDrawing(); });
})();
