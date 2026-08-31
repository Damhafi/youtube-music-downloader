/**
 * YouTube Music Downloader — Extension Popup Logic
 * Detects current YouTube tab, sends download requests to local server.
 * v1.1 — Active downloads progress tracking inline
 */

const API = "http://127.0.0.1:5000/api";

// DOM Elements
const serverStatus = document.getElementById("serverStatus");
const songTitle = document.getElementById("songTitle");
const songMeta = document.getElementById("songMeta");
const btnDownloadCurrent = document.getElementById("btnDownloadCurrent");
const btnDownloadPlaylist = document.getElementById("btnDownloadPlaylist");
const currentFolder = document.getElementById("currentFolder");
const btnChangeFolder = document.getElementById("btnChangeFolder");
const feedback = document.getElementById("feedback");
const activeDownloadsEl = document.getElementById("activeDownloads");
const downloadsItems = document.getElementById("downloadsItems");
const activeBadge = document.getElementById("activeBadge");

let tabUrl = "";
let isPlaylist = false;
let pollTimer = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    await checkServer();
    await detectCurrentTab();
    await loadFolder();
    
    // Start continuous live polling while popup is open
    startProgressPolling();

    btnDownloadCurrent.addEventListener("click", () => download(false));
    btnDownloadPlaylist.addEventListener("click", () => download(true));
    btnChangeFolder.addEventListener("click", changeFolder);
});

// ─── Server Check ─────────────────────────────────────────────────────────────

async function checkServer() {
    try {
        const res = await fetch(`${API}/ping`, { signal: AbortSignal.timeout(3000) });
        const data = await res.json();
        if (data.status === "ok") {
            serverStatus.querySelector(".status-dot").className = "status-dot online";
            serverStatus.title = "Servidor online ✅";
            return true;
        }
    } catch {}

    serverStatus.querySelector(".status-dot").className = "status-dot offline";
    serverStatus.title = "Servidor offline ❌ — Execute start.bat";
    btnDownloadCurrent.disabled = true;
    btnDownloadPlaylist.disabled = true;
    showFeedback("Servidor offline! Execute start.bat", "error");
    return false;
}

// ─── Detect Current Tab ───────────────────────────────────────────────────────

async function detectCurrentTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) {
            songTitle.textContent = "Nenhuma aba ativa";
            return;
        }

        tabUrl = tab.url;

        if (!isYouTubeUrl(tabUrl)) {
            songTitle.textContent = "Abra uma página do YouTube";
            songMeta.textContent = "Esta extensão funciona no YouTube e YouTube Music";
            btnDownloadCurrent.disabled = true;
            btnDownloadPlaylist.disabled = true;
            return;
        }

        // Detect playlist
        isPlaylist = tabUrl.includes("list=");

        // Extract title from tab
        let title = tab.title || "Música do YouTube";
        // Clean common YouTube suffixes
        title = title.replace(/ - YouTube$/i, "")
                     .replace(/ - YouTube Music$/i, "");

        songTitle.textContent = title;

        if (isPlaylist) {
            songMeta.textContent = "Playlist detectada - Voce pode baixar tudo!";
            btnDownloadPlaylist.style.display = "flex";
        } else {
            songMeta.textContent = "Musica individual";
            btnDownloadPlaylist.style.display = "none";
        }

        // Try to detect DOM playlist panel for smart scraping
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const items = document.querySelectorAll(
                        "ytd-playlist-panel-video-renderer#playlist-items"
                    );
                    return items ? items.length : 0;
                },
            });
            const count = results?.[0]?.result || 0;
            if (count > 0) {
                songMeta.textContent = `${count} musicas na playlist lateral`;
                btnDownloadPlaylist.style.display = "flex";
                btnDownloadPlaylist.textContent = `Baixar ${count} Musicas da Playlist`;
                // Mark that we should use DOM scraping
                btnDownloadPlaylist.dataset.useDom = "true";
                btnDownloadPlaylist.dataset.tabId = tab.id;
            }
        } catch {
            // scripting permission may not be available, fallback to URL mode
        }

    } catch (err) {
        songTitle.textContent = "Erro ao detectar aba";
        songMeta.textContent = err.message;
    }
}

// ─── Load Folder ──────────────────────────────────────────────────────────────

async function loadFolder() {
    try {
        const res = await fetch(`${API}/settings`);
        const data = await res.json();
        const folder = data.download_dir || "";
        currentFolder.textContent = shortenPath(folder);
        currentFolder.title = folder;
    } catch {
        currentFolder.textContent = "—";
    }
}

async function changeFolder() {
    try {
        btnChangeFolder.textContent = "...";
        const res = await fetch(`${API}/browse-folder`, { method: "POST" });
        const data = await res.json();
        if (data.folder) {
            currentFolder.textContent = shortenPath(data.folder);
            currentFolder.title = data.folder;
            showFeedback(`📁 ${shortenPath(data.folder)}`, "success");
        }
    } catch {
        showFeedback("Erro ao abrir seletor", "error");
    } finally {
        btnChangeFolder.textContent = "Alterar";
    }
}

// ─── Download ─────────────────────────────────────────────────────────────────

async function download(playlistMode) {
    if (!tabUrl || !isYouTubeUrl(tabUrl)) {
        showFeedback("Abra uma pagina do YouTube primeiro", "error");
        return;
    }

    const btn = playlistMode ? btnDownloadPlaylist : btnDownloadCurrent;
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Baixando...';

    try {
        // Check if DOM scraping mode is active
        if (playlistMode && btn.dataset.useDom === "true") {
            const tabId = parseInt(btn.dataset.tabId, 10);

            // Inject script to scrape the playlist panel from DOM
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    const items = document.querySelectorAll(
                        "ytd-playlist-panel-video-renderer#playlist-items"
                    );
                    const songs = [];
                    const seen = new Set();
                    items.forEach((item) => {
                        const link = item.querySelector("a#wc-endpoint");
                        const titleEl = item.querySelector("span#video-title");
                        const bylineEl = item.querySelector("span#byline");
                        if (!link || !titleEl) return;
                        const href = link.getAttribute("href");
                        if (!href) return;
                        const url = "https://www.youtube.com" + href;
                        const cleanUrl = url.split("&list=")[0].split("&index=")[0];
                        if (seen.has(cleanUrl)) return;
                        seen.add(cleanUrl);
                        songs.push({
                            url: url,
                            title: titleEl.textContent.trim(),
                            artist: bylineEl ? bylineEl.textContent.trim() : "",
                        });
                    });
                    return songs;
                },
            });

            const songs = results?.[0]?.result || [];
            if (songs.length === 0) {
                showFeedback("Nenhuma musica encontrada no painel", "error");
                return;
            }

            // Send batch to server
            const res = await fetch(`${API}/download-batch`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ songs }),
            });

            const data = await res.json();
            if (data.error) {
                showFeedback(`Erro: ${data.error}`, "error");
            } else {
                showFeedback(
                    `${data.queued} musicas na fila!`,
                    "success"
                );
                // Start tracking progress
                startProgressPolling();
            }
        } else {
            // Standard single-track or URL-based playlist download
            const targetUrl = playlistMode ? tabUrl : tabUrl.split("&list=")[0].split("&index=")[0];
            const res = await fetch(`${API}/download`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: targetUrl,
                    playlist: playlistMode,
                }),
            });

            const data = await res.json();

            if (data.error) {
                showFeedback(`Erro: ${data.error}`, "error");
            } else {
                showFeedback(
                    playlistMode
                        ? "Baixando playlist! Veja o progresso abaixo."
                        : "Baixando musica!",
                    "success"
                );
                // Start tracking progress
                startProgressPolling();
            }
        }
    } catch {
        showFeedback("Erro ao conectar com servidor", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

// ─── Active Downloads Progress ────────────────────────────────────────────────

function startProgressPolling() {
    pollActiveDownloads();
    if (!pollTimer) {
        pollTimer = setInterval(pollActiveDownloads, 1000);
    }
}

async function pollActiveDownloads() {
    try {
        const res = await fetch(`${API}/downloads`, { signal: AbortSignal.timeout(2000) });
        const all = await res.json();

        // Update server indicator to online
        if (serverStatus.querySelector(".status-dot").classList.contains("offline")) {
            serverStatus.querySelector(".status-dot").className = "status-dot online";
            serverStatus.title = "Servidor online ✅";
            btnDownloadCurrent.disabled = false;
            btnDownloadPlaylist.disabled = false;
        }

        // Show last 10 downloads (most recent first)
        const recent = all.slice(-10).reverse();

        if (recent.length === 0) {
            activeDownloadsEl.style.display = "none";
            return;
        }

        activeDownloadsEl.style.display = "block";
        const activeCount = recent.filter(
            (d) =>
                d.status === "downloading" ||
                d.status === "queued" ||
                d.status === "retrying"
        ).length;
        activeBadge.textContent = activeCount;

        downloadsItems.innerHTML = recent
            .map((dl) => {
                const icon = getStatusEmoji(dl.status);
                const name = dl.current_file || dl.url.split("v=").pop().substring(0, 20);
                const shortName = name.length > 32 ? name.substring(0, 32) + "..." : name;
                const showProgress = dl.status === "downloading";

                return `
                <div class="dl-item ${dl.status}">
                    <span class="dl-icon">${icon}</span>
                    <div class="dl-info">
                        <div class="dl-name">${shortName}</div>
                        ${
                            showProgress
                                ? `<div class="dl-progress-bar">
                                    <div class="dl-progress-fill" style="width:${dl.progress || 0}%"></div>
                                   </div>`
                                : `<div class="dl-status-text">${getStatusLabel(dl.status)}</div>`
                        }
                    </div>
                </div>
            `;
            })
            .join("");
    } catch {
        // Server might be offline or sleeping
        serverStatus.querySelector(".status-dot").className = "status-dot offline";
        serverStatus.title = "Servidor offline ❌";
    }
}

function getStatusEmoji(status) {
    const map = {
        downloading: "⬇",
        completed: "✅",
        error: "❌",
        queued: "⏳",
        cancelled: "⏹",
        retrying: "🔄",
        skipped: "⏭",
    };
    return map[status] || "❓";
}

function getStatusLabel(status) {
    const map = {
        downloading: "Baixando...",
        completed: "Concluído",
        error: "Erro",
        queued: "Na fila",
        cancelled: "Cancelado",
        retrying: "Tentando novamente...",
        skipped: "Já baixado",
    };
    return map[status] || status;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isYouTubeUrl(url) {
    return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(url);
}

function shortenPath(path) {
    if (!path) return "-";
    const parts = path.replace(/\\/g, "/").split("/");
    if (parts.length <= 3) return path;
    return `.../${parts.slice(-2).join("/")}`;
}

function showFeedback(msg, type = "info") {
    feedback.textContent = msg;
    feedback.className = `popup-feedback ${type}`;
    feedback.style.display = "block";

    setTimeout(() => {
        feedback.style.display = "none";
    }, 5000);
}
