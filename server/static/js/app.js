/**
 * YouTube Music Downloader — Dashboard App Logic
 * Handles URL input, downloads, progress polling, and folder selection.
 */

const API = "http://127.0.0.1:5000/api";

// ─── State ────────────────────────────────────────────────────────────────────
let currentFolder = "";
let activeDownloads = new Set();
let pollInterval = null;

// ─── DOM Elements ─────────────────────────────────────────────────────────────
const urlInput = document.getElementById("urlInput");
const btnPaste = document.getElementById("btnPaste");
const btnFolder = document.getElementById("btnFolder");
const btnDownloadSingle = document.getElementById("btnDownloadSingle");
const btnDownloadPlaylist = document.getElementById("btnDownloadPlaylist");
const folderPath = document.getElementById("folderPath");
const downloadsList = document.getElementById("downloadsList");
const downloadCount = document.getElementById("downloadCount");
const infoPreview = document.getElementById("infoPreview");
const infoThumb = document.getElementById("infoThumb");
const infoTitle = document.getElementById("infoTitle");
const infoChannel = document.getElementById("infoChannel");
const infoBadge = document.getElementById("infoBadge");

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    loadDownloads();

    btnPaste.addEventListener("click", pasteFromClipboard);
    btnFolder.addEventListener("click", browseFolder);
    btnDownloadSingle.addEventListener("click", () => startDownload(false));
    btnDownloadPlaylist.addEventListener("click", () => startDownload(true));

    // Auto-detect URL on paste
    urlInput.addEventListener("input", debounce(onUrlChange, 800));
    urlInput.addEventListener("paste", () => setTimeout(() => onUrlChange(), 100));

    // Start polling for active downloads
    startPolling();
});

// ─── API Calls ────────────────────────────────────────────────────────────────

async function loadSettings() {
    try {
        const res = await fetch(`${API}/settings`);
        const data = await res.json();
        currentFolder = data.download_dir || "";
        folderPath.textContent = shortenPath(currentFolder);
        folderPath.title = currentFolder;
    } catch {
        folderPath.textContent = "Servidor offline";
        showToast("Servidor não está rodando! Execute start.bat", "error");
    }
}

async function browseFolder() {
    try {
        btnFolder.disabled = true;
        btnFolder.textContent = "Abrindo...";
        const res = await fetch(`${API}/browse-folder`, { method: "POST" });
        const data = await res.json();
        if (data.folder) {
            currentFolder = data.folder;
            folderPath.textContent = shortenPath(currentFolder);
            folderPath.title = currentFolder;
            showToast(`📁 Pasta alterada: ${shortenPath(currentFolder)}`, "success");
        }
    } catch {
        showToast("Erro ao abrir seletor de pasta", "error");
    } finally {
        btnFolder.disabled = false;
        btnFolder.textContent = "Alterar Pasta";
    }
}

async function fetchInfo(url) {
    try {
        const res = await fetch(`${API}/info`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

async function startDownload(playlistMode) {
    const url = urlInput.value.trim();
    if (!url) {
        showToast("Cole uma URL do YouTube primeiro!", "error");
        urlInput.focus();
        return;
    }

    if (!isYouTubeUrl(url)) {
        showToast("URL inválida. Use uma URL do YouTube.", "error");
        return;
    }

    const btn = playlistMode ? btnDownloadPlaylist : btnDownloadSingle;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Iniciando...';

    try {
        const res = await fetch(`${API}/download`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url,
                playlist: playlistMode,
                download_dir: currentFolder,
            }),
        });

        const data = await res.json();
        if (data.error) {
            showToast(`Erro: ${data.error}`, "error");
        } else {
            activeDownloads.add(data.id);
            showToast(
                playlistMode
                    ? "🎵 Baixando playlist inteira..."
                    : "🎵 Baixando música...",
                "info"
            );
            loadDownloads();
        }
    } catch {
        showToast("Erro ao conectar com o servidor", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function cancelDownload(id) {
    try {
        await fetch(`${API}/cancel/${id}`, { method: "POST" });
        showToast("Download cancelado", "info");
        loadDownloads();
    } catch {
        showToast("Erro ao cancelar", "error");
    }
}

async function loadDownloads() {
    try {
        const res = await fetch(`${API}/downloads`);
        const data = await res.json();
        renderDownloads(data);
    } catch {
        // Server might be offline
    }
}

// ─── UI Rendering ─────────────────────────────────────────────────────────────

function renderDownloads(downloads) {
    if (!downloads || downloads.length === 0) {
        downloadsList.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
                    <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                </svg>
                <p>Nenhum download ainda. Cole uma URL acima para começar!</p>
            </div>
        `;
        downloadCount.textContent = "0";
        return;
    }

    // Sort: active first, then completed, then errors
    const order = { downloading: 0, queued: 1, completed: 2, error: 3, cancelled: 4 };
    downloads.sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5));

    const activeCount = downloads.filter(d => d.status === "downloading" || d.status === "queued").length;
    downloadCount.textContent = downloads.length;

    // Track active downloads for polling
    activeDownloads = new Set(
        downloads.filter(d => d.status === "downloading" || d.status === "queued").map(d => d.id)
    );

    downloadsList.innerHTML = downloads.map(dl => {
        const statusIcon = getStatusIcon(dl.status);
        const statusText = getStatusText(dl);
        const showProgress = dl.status === "downloading";
        const showCancel = dl.status === "downloading" || dl.status === "queued";

        return `
            <div class="download-item">
                <div class="download-icon ${dl.status}">
                    ${statusIcon}
                </div>
                <div class="download-info">
                    <div class="download-title">${escapeHtml(dl.current_file || dl.url)}</div>
                    <div class="download-status">${statusText}</div>
                    ${showProgress ? `
                        <div class="download-progress-bar">
                            <div class="download-progress-fill" style="width: ${dl.progress || 0}%"></div>
                        </div>
                    ` : ""}
                </div>
                ${showCancel ? `
                    <div class="download-actions">
                        <button class="btn btn-cancel" onclick="cancelDownload('${dl.id}')">Cancelar</button>
                    </div>
                ` : ""}
            </div>
        `;
    }).join("");
}

function getStatusIcon(status) {
    const icons = {
        downloading: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>`,
        completed: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>`,
        error: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
        </svg>`,
        queued: `<div class="spinner"></div>`,
        cancelled: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
        </svg>`,
    };
    return icons[status] || icons.queued;
}

function getStatusText(dl) {
    switch (dl.status) {
        case "downloading":
            let text = `Baixando... ${Math.round(dl.progress || 0)}%`;
            if (dl.playlist_progress) text += ` (Faixa ${dl.playlist_progress})`;
            return text;
        case "completed":
            return "✅ Concluído";
        case "error":
            return `❌ Erro: ${dl.error || "desconhecido"}`;
        case "queued":
            return "⏳ Na fila...";
        case "cancelled":
            return "⏹ Cancelado";
        default:
            return dl.status;
    }
}

// ─── URL Detection ────────────────────────────────────────────────────────────

function isYouTubeUrl(url) {
    return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(url);
}

async function onUrlChange() {
    const url = urlInput.value.trim();
    if (!url || !isYouTubeUrl(url)) {
        infoPreview.style.display = "none";
        return;
    }

    const info = await fetchInfo(url);
    if (!info || info.error) {
        infoPreview.style.display = "none";
        return;
    }

    infoPreview.style.display = "flex";
    infoTitle.textContent = info.title || "Sem título";
    infoChannel.textContent = info.channel || "";

    if (info.thumbnail) {
        infoThumb.src = info.thumbnail;
        infoThumb.style.display = "block";
    } else {
        infoThumb.style.display = "none";
    }

    if (info.type === "playlist") {
        infoBadge.textContent = `Playlist • ${info.count} faixas`;
        infoBadge.className = "badge badge-playlist";
    } else {
        const dur = info.duration ? formatDuration(info.duration) : "";
        infoBadge.textContent = `Música${dur ? " • " + dur : ""}`;
        infoBadge.className = "badge badge-video";
    }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        urlInput.value = text;
        onUrlChange();
    } catch {
        showToast("Não foi possível acessar a área de transferência", "error");
    }
}

function shortenPath(path) {
    if (!path) return "Não definido";
    const parts = path.replace(/\\/g, "/").split("/");
    if (parts.length <= 3) return path;
    return `.../${parts.slice(-2).join("/")}`;
}

function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = "toastOut 0.3s ease forwards";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ─── Polling ──────────────────────────────────────────────────────────────────

function startPolling() {
    // Poll every 1.5s for progress updates
    setInterval(() => {
        if (activeDownloads.size > 0) {
            loadDownloads();
        }
    }, 1500);

    // Also poll less frequently when idle (for ext-initiated downloads)
    setInterval(loadDownloads, 8000);
}
