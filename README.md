# UFO.Cat Security

Electron desktop camera monitor with local camera configuration, webcam preview, and RTSP live streams.

## Run

```sh
npm install
npm start
```

`npm start` builds the local Tailwind stylesheet before opening Electron.

## Frontend development

The renderer uses Tailwind CSS 3.4, pinned for compatibility with the project's
Node 18 runtime. Edit `styles.css`, then use one of these commands:

```sh
npm run watch:css  # rebuild CSS while you work
npm run build      # create local SVG icons and the production stylesheet
npm run format     # format renderer and Electron source files
```

Create a Debian package in `release/` with:

```sh
npm run dist:linux
```

Tailwind scans `index.html` and the renderer JavaScript for class names. The
generated stylesheet is `dist/styles.css`; do not edit it directly. Shared
colors and font stacks live in `tailwind.config.js`.

Interface icons use the Lucide collection from Icônes/Iconify. The selected
icons are listed in `scripts/build-icons.js` and generated as the local
`assets/icons.svg` sprite, so the desktop app does not need network access.

FFmpeg must be installed and available as `ffmpeg` on PATH for RTSP cameras. Change the executable path in **Settings → Video streaming** if it is installed elsewhere. The Settings page can check the executable.

## Camera setup

- **IP camera:** Add a camera, choose **IP camera · RTSP stream**, and enter an `rtsp://` or `rtsps://` URL. URLs with camera credentials are stored in the app's local configuration file.
- **Webcam:** Add a camera, choose **Local webcam**, allow camera access, and select a video device.
- **Workplaces:** Use the tab strip to create and switch workplaces. Choose a workplace in the camera form to assign a camera; rename or delete a workplace from its tab menu. Cameras move to another workplace when a workplace is deleted.
- Use the camera menu to rename or delete a camera. Drag a feed to change its grid position; the order is saved locally.
- Stream quality and automatic reconnect preferences are saved locally. RTSP video is decoded on this computer by FFmpeg and sent to the renderer over a loopback-only MJPEG connection.

The app does not record footage or implement ONVIF PTZ commands yet. Playback and directional PTZ controls therefore do not control or retrieve recordings from cameras.
