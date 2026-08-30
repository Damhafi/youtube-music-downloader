/**
 * YouTube Music Downloader — Extension Popup Logic
 * Detects current YouTube tab, sends download requests to local server.
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

let tabUrl = "";
let isPlaylist = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    await checkServer();
    await detectCurrentTab();
    await loadFolder();

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
                    items.forEach((item) => {
                        const link = item.querySelector("a#wc-endpoint");
                        const titleEl = item.querySelector("span#video-title");
                        const bylineEl = item.querySelector("span#byline");
                        if (!link || !titleEl) return;
                        const href = link.getAttribute("href");
                        if (!href) return;
                        songs.push({
                            url: "https://www.youtube.com" + href,
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
                    `${data.queued} musicas na fila! Veja o Dashboard.`,
                    "success"
                );
            }
        } else {
            // Standard single-track or URL-based playlist download
            const res = await fetch(`${API}/download`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: tabUrl,
                    playlist: playlistMode,
                }),
            });

            const data = await res.json();

            if (data.error) {
                showFeedback(`Erro: ${data.error}`, "error");
            } else {
                showFeedback(
                    playlistMode
                        ? "Baixando playlist! Veja o progresso no Dashboard."
                        : "Baixando musica! Verifique a pasta de destino.",
                    "success"
                );
            }
        }
    } catch {
        showFeedback("Erro ao conectar com servidor", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
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

