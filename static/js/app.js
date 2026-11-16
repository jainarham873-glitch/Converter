// SoundFlux Web App Logic

let currentTaskId = null;
let pollInterval = null;
let sessionHistory = [];
let currentFormat = "mp3"; // "mp3" or "mp4"

// DOM Elements
const urlInput = document.getElementById("url-input");
const btnConvert = document.getElementById("btn-convert");
const btnConvertLabel = document.getElementById("btn-convert-label");
const mediaPreview = document.getElementById("media-preview");
const previewThumb = document.getElementById("preview-thumb");
const previewTitle = document.getElementById("preview-title");
const previewChannel = document.getElementById("preview-channel");
const previewDuration = document.getElementById("preview-duration");

const qualitySelectorMp3 = document.getElementById("quality-selector-mp3");
const qualitySelectorMp4 = document.getElementById("quality-selector-mp4");

const progressContainer = document.getElementById("progress-container");
const progressStatusText = document.getElementById("progress-status-text");
const progressPercent = document.getElementById("progress-percent");
const progressBarFill = document.getElementById("progress-bar-fill");
const progressSpeed = document.getElementById("progress-speed");
const progressEta = document.getElementById("progress-eta");

const errorBox = document.getElementById("error-box");
const errorMessage = document.getElementById("error-message");

const resultBox = document.getElementById("result-box");
const resultTitle = document.getElementById("result-title");
const resultFormatTag = document.getElementById("result-format-tag");
const resultQualityTag = document.getElementById("result-quality-tag");
const resultSizeTag = document.getElementById("result-size-tag");
const downloadLink = document.getElementById("download-link");
const btnDownloadLabel = document.getElementById("btn-download-label");
const btnCopyLink = document.getElementById("btn-copy-link");

// Audio & Video Players
const audioPlayerCard = document.getElementById("audio-player-card");
const videoPlayerCard = document.getElementById("video-player-card");
const mainAudio = document.getElementById("main-audio");
const mainVideo = document.getElementById("main-video");
const playIcon = document.getElementById("play-icon");
const audioSeek = document.getElementById("audio-seek");
const audioVolume = document.getElementById("audio-volume");
const audioCurrent = document.getElementById("audio-current");
const audioDuration = document.getElementById("audio-duration");
const waveVisualizer = document.querySelector(".wave-visualizer");
const historyList = document.getElementById("history-list");

// Format Switcher (MP3 vs MP4)
function setFormat(fmt) {
  currentFormat = fmt;
  const tabMp3 = document.getElementById("tab-mp3");
  const tabMp4 = document.getElementById("tab-mp4");

  if (fmt === "mp3") {
    tabMp3.classList.add("active");
    tabMp4.classList.remove("active");
    qualitySelectorMp3.classList.remove("hidden");
    qualitySelectorMp4.classList.add("hidden");
    btnConvertLabel.textContent = "Convert to MP3";
  } else {
    tabMp4.classList.add("active");
    tabMp3.classList.remove("active");
    qualitySelectorMp4.classList.remove("hidden");
    qualitySelectorMp3.classList.add("hidden");
    btnConvertLabel.textContent = "Convert to MP4";
  }

  lucide.createIcons();
}

// Debounce timer for URL inspection
let inspectTimeout = null;

urlInput.addEventListener("input", () => {
  clearTimeout(inspectTimeout);
  const val = urlInput.value.trim();
  if (val.startsWith("http://") || val.startsWith("https://")) {
    inspectTimeout = setTimeout(() => {
      fetchMediaInfo(val);
    }, 600);
  } else {
    mediaPreview.classList.add("hidden");
  }
});

// Clipboard paste
async function pasteClipboard() {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (text) {
        urlInput.value = text.trim();
        urlInput.dispatchEvent(new Event("input"));
      }
    }
  } catch (err) {
    console.log("Clipboard read not allowed or empty:", err);
  }
}

// Clear input
function clearInput() {
  urlInput.value = "";
  mediaPreview.classList.add("hidden");
  urlInput.focus();
}

// Fetch preview info (title, thumbnail)
async function fetchMediaInfo(url) {
  try {
    const res = await fetch("/api/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (data.success && data.info) {
      const info = data.info;
      previewTitle.textContent = info.title;
      previewChannel.querySelector("span").textContent = info.uploader;
      previewDuration.textContent = info.duration;
      if (info.thumbnail) {
        previewThumb.src = info.thumbnail;
        previewThumb.classList.remove("hidden");
      } else {
        previewThumb.classList.add("hidden");
      }
      mediaPreview.classList.remove("hidden");
    }
  } catch (err) {
    console.warn("Preview fetch error:", err);
  }
}

// Start Conversion
async function startConvert() {
  const url = urlInput.value.trim();
  if (!url) return;

  let quality;
  if (currentFormat === "mp3") {
    quality = document.querySelector('input[name="bitrate"]:checked')?.value || "320";
  } else {
    quality = document.querySelector('input[name="resolution"]:checked')?.value || "1080";
  }

  hideError();
  resultBox.classList.add("hidden");
  mainAudio.pause();
  if (mainVideo) mainVideo.pause();
  resetPlayerUI();

  // Show progress container
  progressContainer.classList.remove("hidden");
  updateProgress(0, `Initiating ${currentFormat.toUpperCase()} conversion...`, "--", "--");
  btnConvert.disabled = true;
  btnConvert.style.opacity = "0.7";

  try {
    const res = await fetch("/api/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, format: currentFormat, quality })
    });
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to start conversion.");
    }

    currentTaskId = data.task_id;
    pollProgress(currentTaskId);
  } catch (err) {
    showError(err.message || "Could not connect to converter backend.");
    progressContainer.classList.add("hidden");
    btnConvert.disabled = false;
    btnConvert.style.opacity = "1";
  }
}

// Poll progress
function pollProgress(taskId) {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/progress/${taskId}`);
      const data = await res.json();

      if (!data.success || !data.task) {
        clearInterval(pollInterval);
        showError("Conversion task lost.");
        btnConvert.disabled = false;
        btnConvert.style.opacity = "1";
        return;
      }

      const task = data.task;
      const status = task.status;
      const fmtUpper = (task.format || "MP3").toUpperCase();

      if (status === "queued") {
        updateProgress(5, `Queued in studio for ${fmtUpper}...`, "--", "--");
      } else if (status === "downloading") {
        const pct = task.percent || 10;
        updateProgress(pct, `Extracting ${fmtUpper} stream (${pct}%)...`, task.speed, task.eta);
      } else if (status === "converting") {
        updateProgress(95, `Encoding high-fidelity ${fmtUpper}...`, "--", "Finalizing");
      } else if (status === "completed") {
        clearInterval(pollInterval);
        updateProgress(100, `${fmtUpper} conversion complete!`, "--", "--");
        setTimeout(() => {
          progressContainer.classList.add("hidden");
          btnConvert.disabled = false;
          btnConvert.style.opacity = "1";
          displayResult(task);
        }, 500);
      } else if (status === "error") {
        clearInterval(pollInterval);
        progressContainer.classList.add("hidden");
        btnConvert.disabled = false;
        btnConvert.style.opacity = "1";
        showError(task.error || "Conversion failed. Please verify the URL.");
      }
    } catch (err) {
      console.error("Polling error:", err);
    }
  }, 750);
}

// Update progress bar
function updateProgress(percent, text, speed, eta) {
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressBarFill.style.width = `${percent}%`;
  progressStatusText.textContent = text;
  progressSpeed.textContent = speed || "--";
  progressEta.textContent = eta || "--";
}

// Display result
function displayResult(task) {
  const isVideo = task.format === "mp4";
  const ext = isVideo ? "mp4" : "mp3";

  resultTitle.textContent = task.title || `media.${ext}`;
  
  if (isVideo) {
    resultFormatTag.innerHTML = `<i data-lucide="video"></i> MP4`;
    const resLabel = task.quality === "best" ? "Source Quality" : `${task.quality}p`;
    resultQualityTag.innerHTML = `<i data-lucide="monitor"></i> ${resLabel}`;
  } else {
    resultFormatTag.innerHTML = `<i data-lucide="file-audio"></i> MP3`;
    resultQualityTag.innerHTML = `<i data-lucide="gauge"></i> ${task.quality || "320"} kbps`;
  }

  resultSizeTag.innerHTML = `<i data-lucide="hard-drive"></i> ${task.file_size || "-- MB"}`;

  downloadLink.href = task.download_url;
  downloadLink.setAttribute("download", `${task.title || "media"}.${ext}`);
  btnDownloadLabel.textContent = `Download ${ext.toUpperCase()}`;

  // Switch between Audio and Video player
  if (isVideo) {
    audioPlayerCard.classList.add("hidden");
    videoPlayerCard.classList.remove("hidden");
    mainAudio.pause();
    mainVideo.src = task.stream_url;
    mainVideo.load();
  } else {
    videoPlayerCard.classList.add("hidden");
    audioPlayerCard.classList.remove("hidden");
    if (mainVideo) {
      mainVideo.pause();
      mainVideo.src = "";
    }
    mainAudio.src = task.stream_url;
    mainAudio.load();
  }

  resultBox.classList.remove("hidden");
  lucide.createIcons();

  // Add to session history
  addToHistory(task);
}

// Audio Player controls
function togglePlayAudio() {
  if (mainAudio.paused) {
    mainAudio.play();
    waveVisualizer.classList.add("playing");
    playIcon.setAttribute("data-lucide", "pause");
  } else {
    mainAudio.pause();
    waveVisualizer.classList.remove("playing");
    playIcon.setAttribute("data-lucide", "play");
  }
  lucide.createIcons();
}

mainAudio.addEventListener("timeupdate", () => {
  if (!mainAudio.duration) return;
  const current = mainAudio.currentTime;
  const duration = mainAudio.duration;
  audioSeek.value = (current / duration) * 100;
  audioCurrent.textContent = formatTime(current);
  audioDuration.textContent = formatTime(duration);
});

mainAudio.addEventListener("ended", () => {
  waveVisualizer.classList.remove("playing");
  playIcon.setAttribute("data-lucide", "play");
  lucide.createIcons();
});

audioSeek.addEventListener("input", () => {
  if (!mainAudio.duration) return;
  const seekTo = (audioSeek.value / 100) * mainAudio.duration;
  mainAudio.currentTime = seekTo;
});

audioVolume.addEventListener("input", () => {
  mainAudio.volume = audioVolume.value;
});

function resetPlayerUI() {
  waveVisualizer.classList.remove("playing");
  playIcon.setAttribute("data-lucide", "play");
  audioSeek.value = 0;
  audioCurrent.textContent = "0:00";
  audioDuration.textContent = "0:00";
  lucide.createIcons();
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

// Copy direct download link
async function copyDownloadLink() {
  if (!currentTaskId) return;
  const fullUrl = `${window.location.origin}/api/download/${currentTaskId}`;
  try {
    await navigator.clipboard.writeText(fullUrl);
    const span = btnCopyLink.querySelector("span");
    const originalText = span.textContent;
    span.textContent = "Copied Link!";
    setTimeout(() => {
      span.textContent = originalText;
    }, 2000);
  } catch (err) {
    alert(`Download Link: ${fullUrl}`);
  }
}

// Reset for another convert
function resetToNew() {
  resultBox.classList.add("hidden");
  urlInput.value = "";
  mediaPreview.classList.add("hidden");
  mainAudio.pause();
  if (mainVideo) {
    mainVideo.pause();
    mainVideo.src = "";
  }
  resetPlayerUI();
  urlInput.focus();
}

// Session History
function addToHistory(task) {
  // Avoid duplicate entries
  if (sessionHistory.some(item => item.task_id === task.task_id)) return;

  const isVideo = task.format === "mp4";
  const qualityDisplay = isVideo 
    ? (task.quality === "best" ? "Max" : `${task.quality}p`)
    : `${task.quality || "320"} kbps`;

  sessionHistory.unshift({
    task_id: task.task_id,
    title: task.title || "media",
    format: task.format || "mp3",
    quality: qualityDisplay,
    file_size: task.file_size,
    download_url: task.download_url,
    stream_url: task.stream_url,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });

  renderHistory();
}

function renderHistory() {
  if (sessionHistory.length === 0) {
    historyList.innerHTML = `
      <div class="history-empty">
        <i data-lucide="inbox"></i>
        <p>No conversions yet in this session. Converted media will appear here for fast re-downloading.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  historyList.innerHTML = sessionHistory.map(item => `
    <div class="history-item">
      <div class="history-item-info">
        <div class="history-item-icon">
          <i data-lucide="${item.format === 'mp4' ? 'video' : 'music'}"></i>
        </div>
        <div class="history-item-text">
          <h5 title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h5>
          <span>${item.format.toUpperCase()} &bull; ${item.quality} &bull; ${item.file_size || ""} &bull; ${item.time}</span>
        </div>
      </div>
      <div class="history-item-actions">
        <a href="${item.download_url}" class="btn-history-dl" download>
          <i data-lucide="download"></i> Download
        </a>
      </div>
    </div>
  `).join("");

  lucide.createIcons();
}

function clearHistory() {
  sessionHistory = [];
  renderHistory();
}

function showError(msg) {
  errorMessage.textContent = msg;
  errorBox.classList.remove("hidden");
  lucide.createIcons();
}

function hideError() {
  errorBox.classList.add("hidden");
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}
