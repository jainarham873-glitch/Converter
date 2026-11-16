# SoundFlux — Link to MP3 Studio Converter

A full-stack, studio-grade web application to convert video and audio links into high-quality MP3 files with built-in playback and download capabilities.

---

## 🎨 Theme & UI
- **Obsidian & Cyber Emerald** dark studio aesthetic.
- **Strictly NO purple gradients** or violet hues.
- Glassmorphism surfaces, glowing status indicators, and animated audio waveforms.

---

## ⚡ Features
- **Universal Link Support**: Powered by `yt-dlp` and `FFmpeg` to extract audio from YouTube, SoundCloud, TikTok, Twitter/X, Instagram, Vimeo, and direct media URLs (.mp4, .webm, .m4a, .wav).
- **Audio Quality Selection**: Convert to 320 kbps (Studio), 256 kbps (High), 192 kbps (Standard), or 128 kbps (Compact).
- **Pre-Conversion Preview**: Automatically shows video thumbnail, title, channel, and duration when you paste a link.
- **Real-Time Progress**: Live download percentage, transfer speed, and ETA timers.
- **In-Page Audio Player**: Stream and preview the converted MP3 right on the web page with custom seek and volume controls.
- **Instant Download**: One-click download button and direct link copier.
- **Session History**: Keeps a list of converted tracks during your session for quick access.

---

## 🚀 How to Run

### Method 1: One-Click (Recommended)
Simply double-click:
```
D:\converter\start.bat
```
It will automatically launch the server and open `http://localhost:5000` in your default browser.

### Method 2: Command Line
Open a terminal in `D:\converter` and run:
```bash
python app.py
```
Then navigate to:
```
http://localhost:5000
```
