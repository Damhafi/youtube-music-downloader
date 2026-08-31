/**
 * YouTube Music Downloader — Content Script
 * Scrapes the playlist panel DOM (ytd-playlist-panel-renderer)
 * to extract all visible songs and send them for download.
 *
 * v1.1 — Auto-scroll, selection panel with checkboxes, progress tracking
 */

(function () {
    "use strict";

    const API = "http://127.0.0.1:5000/api";

    // Avoid double injection
    if (document.getElementById("ytmd-fab")) return;

    // ─── Utilities ──────────────────────────────────────────────────────────

    function escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    function shortenPath(path) {
        if (!path) return "Nao definido";
        const parts = path.replace(/\\/g, "/").split("/");
        if (parts.length <= 3) return path;
        return ".../" + parts.slice(-2).join("/");
    }

    // ─── Scrape Playlist from DOM ───────────────────────────────────────────

    function scrapePlaylistFromDOM() {
        const items = document.querySelectorAll(
            "ytd-playlist-panel-video-renderer#playlist-items"
        );

        if (!items || items.length === 0) return [];

        const songs = [];
        const seen = new Set();

        items.forEach((item) => {
            const link = item.querySelector("a#wc-endpoint");
            const titleEl = item.querySelector("span#video-title");
            const bylineEl = item.querySelector("span#byline");

            if (!link || !titleEl) return;

            const href = link.getAttribute("href");
            if (!href) return;

            // Build full URL
            const url = "https://www.youtube.com" + href;

            // Deduplicate by video ID
            const cleanUrl = url.split("&list=")[0].split("&index=")[0];
            if (seen.has(cleanUrl)) return;
            seen.add(cleanUrl);

            const title = titleEl.textContent.trim();
            const artist = bylineEl ? bylineEl.textContent.trim() : "";

            songs.push({ url, title, artist });
        });

        return songs;
    }

    // ─── Auto-scroll Playlist Panel ─────────────────────────────────────────

    async function autoScrollPlaylist(onProgress) {
        const panel = document.querySelector("ytd-playlist-panel-renderer");
        if (!panel) return 0;

        let previousCount = 0;
        let stableRounds = 0;
        const maxAttempts = 150;

        for (let i = 0; i < maxAttempts; i++) {
            const items = document.querySelectorAll(
                "ytd-playlist-panel-video-renderer#playlist-items"
            );
            const currentCount = items.length;

            if (onProgress) onProgress(currentCount);

            if (currentCount === previousCount) {
                stableRounds++;
                if (stableRounds >= 4) break; // No new items after 4 rounds — done
            } else {
                stableRounds = 0;
            }

            previousCount = currentCount;

            // Scroll last item into view to trigger lazy loading
            if (items.length > 0) {
                items[items.length - 1].scrollIntoView({
                    behavior: "instant",
                    block: "end",
                });
            }

            await new Promise((r) => setTimeout(r, 500));
        }

        return previousCount;
    }

    // ─── Selection Panel (Overlay) ──────────────────────────────────────────

    function showSelectionPanel(songs) {
        return new Promise((resolve) => {
            // Remove existing panel if any
            const existing = document.getElementById("ytmd-selection-overlay");
            if (existing) existing.remove();

            const overlay = document.createElement("div");
            overlay.id = "ytmd-selection-overlay";
            overlay.innerHTML = `
                <div class="ytmd-selection-panel">
                    <div class="ytmd-selection-header">
                        <div class="ytmd-selection-title">
                            <span class="ytmd-selection-icon">📋</span>
                            <div>
                                <h3>Selecionar Músicas</h3>
                                <small>${songs.length} encontradas na playlist</small>
                            </div>
                        </div>
                        <button class="ytmd-selection-close" id="ytmd-close-selection">✕</button>
                    </div>
                    <div class="ytmd-selection-toolbar">
                        <button class="ytmd-toolbar-btn" id="ytmd-select-all">✓ Todas</button>
                        <button class="ytmd-toolbar-btn" id="ytmd-deselect-all">✗ Limpar</button>
                        <span class="ytmd-toolbar-count" id="ytmd-sel-count">${songs.length} selecionadas</span>
                    </div>
                    <div class="ytmd-selection-list" id="ytmd-song-list">
                        ${songs
                            .map(
                                (s, i) => `
                            <label class="ytmd-song-item" data-index="${i}">
                                <input type="checkbox" checked class="ytmd-song-check" data-index="${i}">
                                <div class="ytmd-song-info">
                                    <span class="ytmd-song-name">${escapeHtml(s.title)}</span>
                                    <span class="ytmd-song-artist">${escapeHtml(s.artist)}</span>
                                </div>
                            </label>
                        `
                            )
                            .join("")}
                    </div>
                    <div class="ytmd-selection-footer">
                        <span id="ytmd-footer-count">${songs.length} selecionadas</span>
                        <button class="ytmd-btn-download-sel" id="ytmd-download-selected">
                            ⬇ Baixar Selecionadas (${songs.length})
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            // ─── Update selected count ──────────────────────────────────
            function updateCount() {
                const checks = overlay.querySelectorAll(".ytmd-song-check:checked");
                const count = checks.length;
                const countEl = overlay.querySelector("#ytmd-sel-count");
                const footerEl = overlay.querySelector("#ytmd-footer-count");
                const btnEl = overlay.querySelector("#ytmd-download-selected");
                if (countEl) countEl.textContent = `${count} selecionadas`;
                if (footerEl) footerEl.textContent = `${count} selecionadas`;
                if (btnEl) {
                    btnEl.textContent = `⬇ Baixar Selecionadas (${count})`;
                    btnEl.disabled = count === 0;
                }
            }

            // ─── Event listeners ────────────────────────────────────────
            overlay.querySelectorAll(".ytmd-song-check").forEach((cb) => {
                cb.addEventListener("change", updateCount);
            });

            overlay.querySelector("#ytmd-select-all").addEventListener("click", () => {
                overlay.querySelectorAll(".ytmd-song-check").forEach((cb) => (cb.checked = true));
                updateCount();
            });

            overlay.querySelector("#ytmd-deselect-all").addEventListener("click", () => {
                overlay.querySelectorAll(".ytmd-song-check").forEach((cb) => (cb.checked = false));
                updateCount();
            });

            overlay.querySelector("#ytmd-close-selection").addEventListener("click", () => {
                overlay.remove();
                resolve(null);
            });

            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve(null);
                }
            });

            overlay.querySelector("#ytmd-download-selected").addEventListener("click", () => {
                const checks = overlay.querySelectorAll(".ytmd-song-check:checked");
                const selected = [];
                checks.forEach((cb) => {
                    const idx = parseInt(cb.dataset.index, 10);
                    selected.push(songs[idx]);
                });
                overlay.remove();
                resolve(selected);
            });
        });
    }

    // ─── Get Current Video Info ─────────────────────────────────────────────

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
                    <strong>Playlist (Selecionar)</strong>
                    <small id="ytmd-playlist-count">0 musicas</small>
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
                playlistCount.textContent = `${songs.length} musicas (clique para selecionar)`;
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

            if (action === "current") {
                // Download single current video
                btnDownload.classList.add("ytmd-loading");
                await downloadSingle();
                btnDownload.classList.remove("ytmd-loading");
            } else if (action === "playlist-dom") {
                // Download playlist with selection
                await downloadPlaylistWithSelection();
            }
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
                showToast("⬇ Baixando musica atual...", "success");
                trackDownloadProgress([data.id]);
            }
        } catch {
            showToast("Servidor offline! Execute start.bat", "error");
        }
    }

    async function downloadPlaylistWithSelection() {
        // Step 1: Show loading toast
        showToast("🔄 Carregando playlist completa...", "info");
        btnDownload.classList.add("ytmd-loading");

        // Step 2: Auto-scroll to load all items
        await autoScrollPlaylist((count) => {
            showToast(`🔄 Carregando... ${count} músicas encontradas`, "info");
        });

        // Step 3: Scrape all songs
        const songs = scrapePlaylistFromDOM();
        btnDownload.classList.remove("ytmd-loading");

        if (songs.length === 0) {
            showToast("Nenhuma musica encontrada na playlist", "error");
            return;
        }

        showToast(`✅ ${songs.length} músicas encontradas!`, "success");

        // Step 4: Show selection panel
        const selected = await showSelectionPanel(songs);

        if (!selected || selected.length === 0) {
            showToast("Download cancelado", "info");
            return;
        }

        // Step 5: Send batch request
        showToast(`⬇ Enviando ${selected.length} musicas para download...`, "info");

        try {
            const res = await fetch(`${API}/download-batch`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ songs: selected }),
            });

            const data = await res.json();
            if (data.error) {
                showToast("Erro: " + data.error, "error");
            } else {
                showToast(
                    `✅ ${data.queued} musicas na fila de download!`,
                    "success"
                );
                trackDownloadProgress(data.ids);
            }
        } catch {
            showToast("Servidor offline! Execute start.bat", "error");
        }
    }

    // ─── Progress Tracking ──────────────────────────────────────────────────

    async function trackDownloadProgress(ids) {
        if (!ids || ids.length === 0) return;

        const pollInterval = setInterval(async () => {
            try {
                const res = await fetch(`${API}/progress-batch`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ids }),
                });
                const items = await res.json();

                const active = items.filter(
                    (d) =>
                        d.status === "downloading" ||
                        d.status === "queued" ||
                        d.status === "retrying"
                );
                const completed = items.filter((d) => d.status === "completed");
                const skipped = items.filter((d) => d.status === "skipped");
                const errors = items.filter((d) => d.status === "error");

                if (active.length > 0) {
                    const downloading = items.filter(
                        (d) => d.status === "downloading"
                    );
                    if (downloading.length > 0) {
                        const prog = Math.round(downloading[0].progress || 0);
                        const file = downloading[0].current_file || "...";
                        const shortFile =
                            file.length > 35 ? file.substring(0, 35) + "..." : file;
                        showToast(
                            `⬇ ${shortFile} (${prog}%) | Fila: ${active.length}`,
                            "info"
                        );
                    }
                } else {
                    // All done
                    clearInterval(pollInterval);
                    const msg = [];
                    if (completed.length > 0)
                        msg.push(`✅ ${completed.length} baixadas`);
                    if (skipped.length > 0)
                        msg.push(`⏭ ${skipped.length} já existiam`);
                    if (errors.length > 0)
                        msg.push(`❌ ${errors.length} falharam`);
                    showToast(
                        msg.join(" | ") || "Download concluído!",
                        "success"
                    );

                    // Send Chrome notification
                    try {
                        chrome.runtime.sendMessage({
                            action: "notify",
                            title: "🎵 Downloads Concluídos",
                            message:
                                msg.join(" | ") || "Todos os downloads foram finalizados!",
                        });
                    } catch {
                        // Extension context might not be available
                    }
                }
            } catch {
                clearInterval(pollInterval);
            }
        }, 2500);
    }

    // ─── Toast ──────────────────────────────────────────────────────────────

    let toastTimeout = null;

    function showToast(msg, type = "info") {
        if (toastTimeout) clearTimeout(toastTimeout);
        toastEl.textContent = msg;
        toastEl.className = `ytmd-toast ytmd-toast-${type}`;
        toastEl.style.display = "block";

        toastTimeout = setTimeout(() => {
            toastEl.style.display = "none";
        }, 5000);
    }
})();
