# 🎰 AO3 Chaos Extension

A lovingly terrible browser extension that adds the **worst possible features** to Archive of Our Own.
Inspired by the r/AO3 "worst possible AO3 features" meme post.

---
##  Installation

1. Download the .zip for your Browser
2. Unzip/extract the .zip :)


### Chrome / Chromium / Edge / Brave
1. Open `chrome://extensions/`
2. Enable **Developer Mode** (top right toggle)
3. Click **"Load unpacked"**
4. Select the `ao3-chaos-extension` folder
5. Visit [archiveofourown.org](https://archiveofourown.org) and enjoy the chaos

### Firefox


1. Open `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on..."**
3. Select the `manifest.json` file inside the `ao3-chaos-extension` folder
4. Visit [archiveofourown.org](https://archiveofourown.org) and enjoy the chaos

**Note:** Temporary Firefox extensions are removed on browser restart.  

---


> For a permanent install, you'd need to sign it via [AMO](https://addons.mozilla.org/en-US/developers/).
## ✨ Features

### 🎰 Slot Machine Gambling Ads
Three authentic-looking terrible banner ads injected into AO3 pages, each containing a working slot machine. Pull the lever — if you get three matching symbols, you win! (Prize: the satisfaction of winning a fake internet slot machine.)

### 💎 Upgrade to Premium
Characters, Relationships, and Additional Tags are blurred out behind a **"Upgrade to Premium"** overlay. Click it → confirm "Buy" → premium unlocked permanently. The options page lets you reset it at any time.

### 🏆 Trophy System
Every fic gets a **"Give Trophy"** button. Awarded trophies get an "algorithm boost" (not real). View all your trophies in the nav bar under **"🏆 My Trophies"**, and manage them in the extension settings.

### 📍 Reveal Author's Location
A button on every fic listing that dramatically scans, triangulates, and reveals the author's location (e.g., "Their Childhood Bedroom at 2am", "A Starbucks During Work Hours").

### 🤖 AI Summarize
An AI Summarize button on every fic that produces a hilariously vague AI summary like *"This story contains characters. Events occur. At least one person has feelings about this."*

### 👍👎 Like / Dislike Buttons
Every fic gets Like and Dislike buttons with comically inflated fake counts (your personal votes are saved locally).

### 🔞 Age Verification
Explicit-rated works require you to confirm you are 18+. If you click "No", you are redirected to the Teletubbies Wikipedia page. Once verified, you stay verified (or reset in settings).

### 📚 Daily Reading Limit
You can only read **5 fics per day** before hitting the paywall. Premium removes the limit. Resets at midnight.

### 🪪 Verify Your Name / 💵 Make $ with AO3
Two extra nav items: "Verify your name" (enter your legal name, get told it's been verified and "probably not" shared) and "Make $ with AO3" (apply to earn $0.00001 per kudos — response time: 3–5 business decades).

### 🖼️ Author Face ID
Individual work pages show a "Author Face ID" in the metadata with a randomly assigned face and a confidence percentage.

---

## ⚙️ Settings

Click the extension icon in your toolbar (or go to the extension's options) to:
- See your Premium status and reset it
- View your reading stats for today
- Browse all the trophies you've awarded (with links)
- Nuke everything and start fresh

---

## 📁 File Structure

```
ao3-chaos-extension/
├── manifest_chrome.json    ← Rename to manifest.json for Chrome
├── manifest_firefox.json   ← Rename to manifest.json for Firefox
├── content.js              ← All injected features
├── content.css             ← All injected styles
├── options.html            ← Settings page
├── options.js              ← Settings page logic
├── background.js           ← Storage bridge between content & options
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## ⚠️ Disclaimer

This is a **joke extension** for entertainment purposes. It does not:
- Actually charge you money
- Actually reveal anyone's location
- Actually implement gambling
- Actually share your name with anyone
- Actually give fics an algorithm boost (as if AO3 has one)

AO3 is a wonderful nonprofit run by volunteers. Please support them at [ao3.org](https://archiveofourown.org/donate).

---

*Made with 💾 and extremely poor taste*
