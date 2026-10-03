# Paramount Control+

A Chrome and Edge extension for Paramount+.

## What it does

Paramount lists the qualities available for each video. The extension limits
which ones the player can choose. The player still downloads and plays the original streams.

- **Auto:** lets the player choose from the full list.
- **Keep sharp:** keeps the highest compatible choices.
- **Manual:** keeps your chosen resolution and the closest available bitrate, where supported.
- **Remove menu:** removes the video sidebar when it appears. Switch it off to bring the menu back.
- **Playback details:** shows the current resolution and bitrate.
- **Dark mode:** changes the popup's appearance.

Settings are saved automatically. Changing quality reloads the player. If playback
fails after a quality selection, it reloads once into Auto and stays there for the current title.
Only qualities offered by Paramount are available.

## Install

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on **Developer mode**, click **Load unpacked**, and select this folder. If already installed, click **Reload** to update it.
3. Refresh Paramount+.
4. Open the popup from the toolbar icon or the Edge app's **… → Extensions** menu.

[Quality engine attribution and license](quality/NOTICE.md).

Unofficial extension; not affiliated with Paramount+.
