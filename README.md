# 🎵 YouTube Music Downloader

Download YouTube songs and playlists as high-quality MP3 (320kbps) with a single click from your browser.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.8+-3776AB?logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-Server-000000?logo=flask&logoColor=white)

## ✨ Features

- **One-click download** — Floating button on YouTube pages
- **Playlist scraping** — Reads the sidebar playlist panel directly from the DOM
- **Batch download** — Download all songs from a playlist at once
- **MP3 320kbps** — Best audio quality with embedded album art
- **Custom folder** — Choose where to save via native folder picker
- **Real-time dashboard** — Track download progress at `http://localhost:5000`
- **Chrome Extension** — Manifest V3, works on YouTube and YouTube Music

## 🏗️ Architecture

```
┌─────────────────────┐     HTTP      ┌────────────────────┐
│  Chrome Extension   │ ─────────────▶│  Flask Server      │
│  (content.js + FAB) │   /api/*      │  (app.py)          │
│  (popup)            │               │  ├─ yt-dlp         │
└─────────────────────┘               │  ├─ FFmpeg         │
                                      │  └─ Dashboard UI   │
                                      └────────────────────┘
```

## 📦 Setup

### Prerequisites
- **Python 3.8+**
- **Google Chrome**
- **FFmpeg** (auto-detected or place in `server/ffmpeg/`)

### 1. Install Dependencies

```bash
cd server
pip install flask flask-cors yt-dlp
```

### 2. Start the Server

Double-click `start.bat` or run:

```bash
cd server
python app.py
```

The dashboard will be available at `http://localhost:5000`.

### 3. Install the Chrome Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder

## 🎮 Usage

### Single Song
1. Open a YouTube video
2. Click the purple floating button (bottom-right)
3. Select **"Música Atual"**

### Full Playlist
1. Open a YouTube video with a playlist/mix in the sidebar
2. Click the floating button
3. Select **"Toda a Playlist"** — it scrapes all visible songs from the sidebar
4. All songs are queued and downloaded as individual MP3 files

### Change Download Folder
- Click **"Alterar Pasta"** in the menu to open the native folder picker
- Or change it from the dashboard at `http://localhost:5000`

## 📁 Project Structure

```
├── extension/           # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── content.js       # DOM scraping + floating button
│   ├── content.css      # FAB styles
│   ├── popup.html       # Extension popup UI
│   ├── popup.js         # Popup logic with DOM scraping
│   ├── popup.css
│   ├── background.js    # Service worker
│   └── icons/           # Extension icons
├── server/              # Python Flask backend
│   ├── app.py           # API server + yt-dlp wrapper
│   ├── requirements.txt
│   └── static/          # Dashboard UI
│       ├── index.html
│       ├── css/style.css
│       └── js/app.js
├── start.bat            # Windows launcher
├── .gitignore
└── README.md
```

## 🔧 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ping` | Health check |
| POST | `/api/download` | Download single video/playlist by URL |
| POST | `/api/download-batch` | Batch download from DOM-scraped songs |
| GET | `/api/downloads` | List all downloads |
| GET | `/api/progress/:id` | Get download progress |
| POST | `/api/cancel/:id` | Cancel a download |
| GET | `/api/settings` | Get current settings |
| POST | `/api/settings` | Update settings |
| POST | `/api/browse-folder` | Open native folder picker |

## 📝 License

MIT
