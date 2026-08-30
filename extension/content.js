/**
 * YouTube Music Downloader — Content Script
 * Scrapes the playlist panel DOM (ytd-playlist-panel-renderer)
 * to extract all visible songs and send them for download.
 */

(function () {
    "use strict";

    const API = "http://127.0.0.1:5000/api";

    // Avoid double injection
    if (document.getElementById("ytmd-fab")) return;

    // ─── Scrape Playlist from DOM ───────────────────────────────────────────

    function scrapePlaylistFromDOM() {
        const items = document.querySelectorAll(
            "ytd-playlist-panel-video-renderer#playlist-items"
        );

        if (!items || items.length === 0) return [];

        const songs = [];
        items.forEach((item) => {
            const link = item.querySelector("a#wc-endpoint");
            const titleEl = item.querySelector("span#video-title");
            const bylineEl = item.querySelector("span#byline");

            if (!link || !titleEl) return;

            const href = link.getAttribute("href");
            if (!href) return;

            // Build full URL
            const url = "https://www.youtube.com" + href;
            const title = titleEl.textContent.trim();
            const artist = bylineEl ? bylineEl.textContent.trim() : "";

            songs.push({ url, title, artist });
        });

        return songs;
    }

    function getCurrentVideoInfo() {
        // Get current playing video
        const titleEl = document.querySelector(
            "yt-formatted-string.ytd-watch-metadata"
        ) || document.querySelector("h1.ytd-watch-metadata yt-formatted-string");

        const channelEl = document.querySelector(
            "ytd-channel-name yt-formatted-string a"
        );

        return {
            url: window.location.href,
            title: titleEl ? titleEl.textContent.trim() : document.title.replace(/ - YouTube$/, ""),
            artist: channelEl ? channelEl.textContent.trim() : "",
        };
    }

    function hasPlaylistPanel() {
        const panel = document.querySelector("ytd-playlist-panel-renderer#playlist");
        return panel !== null;
    }

    // ─── Create Floating Action Button ──────────────────────────────────────

    const fab = document.createElement("div");
    fab.id = "ytmd-fab";
    fab.innerHTML = `
        <button id="ytmd-btn-download" class="ytmd-fab-btn" title="Baixar musica">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
        </button>
        <div id="ytmd-fab-menu" class="ytmd-fab-menu" style="display:none">
            <div class="ytmd-menu-header">O que deseja baixar?</div>
            <button class="ytmd-menu-item" data-action="current">
                <span class="ytmd-menu-icon">&#127925;</span>
                <div class="ytmd-menu-text">
                    <strong>Musica Atual</strong>
                    <small id="ytmd-current-title">Carregando...</small>
                </div>
            </button>
            <button class="ytmd-menu-item" data-action="playlist-dom" id="ytmd-btn-playlist-dom" style="display:none">
                <span class="ytmd-menu-icon">&#128203;</span>
                <div class="ytmd-menu-text">
                    <strong>Toda a Playlist</strong>
                    <small id="ytmd-playlist-count">0 musicas da playlist lateral</small>
                </div>
            </button>
            <div class="ytmd-menu-divider" id="ytmd-divider" style="display:none"></div>
            <button class="ytmd-menu-item ytmd-menu-item-folder" data-action="folder">
                <span class="ytmd-menu-icon">&#128194;</span>
                <div class="ytmd-menu-text">
                    <strong>Alterar Pasta</strong>
                    <small id="ytmd-folder-path">Carregando...</small>
                </div>
            </button>
        </div>
        <div id="ytmd-toast" class="ytmd-toast" style="display:none"></div>
    `;

    document.body.appendChild(fab);

    // ─── Elements ───────────────────────────────────────────────────────────

    const btnDownload = document.getElementById("ytmd-btn-download");
    const fabMenu = document.getElementById("ytmd-fab-menu");
    const btnPlaylistDom = document.getElementById("ytmd-btn-playlist-dom");
    const playlistCount = document.getElementById("ytmd-playlist-count");
    const currentTitle = document.getElementById("ytmd-current-title");
    const folderPath = document.getElementById("ytmd-folder-path");
    const divider = document.getElementById("ytmd-divider");
    const toastEl = document.getElementById("ytmd-toast");

    // ─── Load folder path ───────────────────────────────────────────────────
    async function loadFolder() {
        try {
            const res = await fetch(`${API}/settings`);
            const data = await res.json();
            folderPath.textContent = shortenPath(data.download_dir || "");
        } catch {
            folderPath.textContent = "Servidor offline";
        }
    }

    function shortenPath(path) {
        if (!path) return "Nao definido";
        const parts = path.replace(/\\/g, "/").split("/");
        if (parts.length <= 3) return path;
        return ".../" + parts.slice(-2).join("/");
    }

    // ─── Toggle Menu ────────────────────────────────────────────────────────

    let menuOpen = false;

    btnDownload.addEventListener("click", (e) => {
        e.stopPropagation();
        menuOpen = !menuOpen;
        fabMenu.style.display = menuOpen ? "flex" : "none";

        if (menuOpen) {
            // Update current song title
            const info = getCurrentVideoInfo();
            currentTitle.textContent = info.title.substring(0, 50) + (info.title.length > 50 ? "..." : "");

            // Check for playlist panel in DOM
            const songs = scrapePlaylistFromDOM();
            if (songs.length > 0) {
                btnPlaylistDom.style.display = "flex";
                divider.style.display = "block";
                playlistCount.textContent = `${songs.length} musicas da playlist lateral`;
            } else {
                btnPlaylistDom.style.display = "none";
                divider.style.display = "none";
            }

            loadFolder();
        }
    });

    document.addEventListener("click", (e) => {
        if (!fab.contains(e.target)) {
            menuOpen = false;
            fabMenu.style.display = "none";
        }
    });

    // ─── Menu Actions ───────────────────────────────────────────────────────

    document.querySelectorAll(".ytmd-menu-item").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;

            if (action === "folder") {
                // Open folder picker
                try {
                    folderPath.textContent = "Abrindo...";
                    const res = await fetch(`${API}/browse-folder`, { method: "POST" });
                    const data = await res.json();
                    if (data.folder) {
                        folderPath.textContent = shortenPath(data.folder);
                        showToast("Pasta alterada!", "success");
                    } else {
                        loadFolder();
                    }
                } catch {
                    showToast("Erro ao abrir seletor", "error");
                    loadFolder();
                }
                return;
            }

            fabMenu.style.display = "none";
            menuOpen = false;

            // Visual feedback
            btnDownload.classList.add("ytmd-loading");

            if (action === "current") {
                // Download single current video
                await downloadSingle();
            } else if (action === "playlist-dom") {
                // Download all songs from DOM playlist
                await downloadPlaylistFromDOM();
            }

            btnDownload.classList.remove("ytmd-loading");
        });
    });

    // ─── Download Functions ─────────────────────────────────────────────────

    async function downloadSingle() {
        try {
            const res = await fetch(`${API}/download`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: window.location.href,
                    playlist: false,
                }),
            });

            const data = await res.json();
            if (data.error) {
                showToast("Erro: " + data.error, "error");
            } else {
                showToast("Baixando musica atual...", "success");
            }
        } catch {
            showToast("Servidor offline! Execute start.bat", "error");
        }
    }

    async function downloadPlaylistFromDOM() {
        const songs = scrapePlaylistFromDOM();

        if (songs.length === 0) {
            showToast("Nenhuma musica encontrada na playlist", "error");
            return;
        }

        showToast(`Enviando ${songs.length} musicas para download...`, "info");

        try {
            // Send batch request with all URLs scraped from DOM
            const res = await fetch(`${API}/download-batch`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    songs: songs,
                }),
            });

            const data = await res.json();
            if (data.error) {
                showToast("Erro: " + data.error, "error");
            } else {
                showToast(
                    `${data.queued} musicas na fila de download!`,
                    "success"
                );
            }
        } catch {
            showToast("Servidor offline! Execute start.bat", "error");
        }
    }

    // ─── Toast ──────────────────────────────────────────────────────────────

    function showToast(msg, type = "info") {
        toastEl.textContent = msg;
        toastEl.className = `ytmd-toast ytmd-toast-${type}`;
        toastEl.style.display = "block";

        setTimeout(() => {
            toastEl.style.display = "none";
        }, 4000);
    }
})();
