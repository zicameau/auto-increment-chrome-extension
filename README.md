# Firefox Auto-Increment Extension - Installation Guide

## 📦 What You Need

I've created a complete Firefox extension with these files:
- `manifest.json` - Extension configuration
- `popup.html` - The main interface (popup when you click the extension icon)
- `popup.js` - Popup functionality 
- `content.js` - Script that runs on web pages
- `background.js` - Background processes
- Icon files (you'll need to create simple icons)

## 🚀 Installation Steps

### Step 1: Create the Extension Folder
1. Create a new folder on your computer called `auto-increment-extension`
2. Save each file I provided into this folder with the correct filename

### Step 2: Create Simple Icons
Create three simple icon files (or use any 16x16, 48x48, and 128x128 PNG images):
- `icon16.png` (16x16 pixels)
- `icon48.png` (48x48 pixels) 
- `icon128.png` (128x128 pixels)

*You can create simple colored squares in any image editor, or download free icons from sites like IconFinder.*

### Step 3: Load the Extension in Firefox

#### Method A: Temporary Installation (for testing)
1. Open Firefox
2. Type `about:debugging` in the address bar
3. Click "This Firefox" on the left
4. Click "Load Temporary Add-on..."
5. Navigate to your extension folder and select `manifest.json`
6. The extension will appear in your toolbar!

#### Method B: Developer Mode (more permanent)
1. Open Firefox
2. Type `about:config` in address bar (accept warnings)
3. Search for `xpinstall.signatures.required`
4. Double-click to set it to `false`
5. Then zip your extension folder
6. Go to `about:addons`
7. Click the gear icon → "Install Add-on From File"
8. Select your zip file

## 🎯 How to Use

1. **Click the extension icon** in your Firefox toolbar
2. **Click "Select Input Field"** 
3. **Click on any input field** on the webpage (like eBay's search box)
4. **Set your preferences**:
   - Start Value (e.g., 1)  
   - Increment By (e.g., 1)
   - Interval (e.g., 1 second)
   - Enable "Press Enter after input" for auto-submit
5. **Click "Start"** and watch it work!

## ✨ Features

- 🎯 **Easy Target Selection**: Click to select any input field
- ⚙️ **Customizable Settings**: Start value, increment, timing
- 🎮 **Full Control**: Start, Pause, Resume, Stop
- 💾 **Remembers Settings**: Your preferences are saved
- 🔄 **Auto-Submit**: Optionally press Enter after each input
- 📊 **Visual Feedback**: See current value and progress
- 🛡️ **Safe**: Only works on input fields you select

## 🔧 Troubleshooting

**Extension won't load?**
- Make sure all files are in the same folder
- Check that `manifest.json` is valid JSON
- Ensure you have the icon files

**Can't select target?**
- Make sure you clicked "Select Input Field" first
- Only text input fields can be selected
- Try refreshing the page and trying again

**Not working on a specific site?**
- Some sites block extensions - this is normal
- Try on a different website to test

## 🎮 Keyboard Shortcuts

The extension supports these shortcuts when the popup is open:
- **Ctrl+Space** (Cmd+Space on Mac): Start/Pause
- **Escape**: Stop

## 🔄 Updates

To update the extension:
1. Modify the files in your extension folder
2. Go to `about:debugging` 
3. Click "Reload" next to your extension

## 💡 Pro Tips

- **For eBay**: The search box usually works perfectly
- **Test First**: Always click "Select Input Field" and test before starting
- **Be Respectful**: Don't use this to spam or overload websites
- **Check Terms**: Make sure automated input is allowed on the sites you use

This extension is much more reliable than the HTML tool because it:
- ✅ Works across all browser tabs
- ✅ Maintains connection even when switching tabs
- ✅ Has proper permissions to interact with web pages
- ✅ Saves your settings between sessions
- ✅ Provides better error handling

Enjoy your new auto-increment tool! 🎉