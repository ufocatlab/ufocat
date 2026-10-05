const api = window.surveillance;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const toast = $("#toast");
const cameraModal = $("#cameraModal");
const icon = (name, className = "icon") =>
  `<svg class="${className}" aria-hidden="true"><use href="assets/icons.svg#icon-${name}"></use></svg>`;
const state = {
  cameras: [],
  workspaces: [],
  activeWorkspaceId: null,
  settings: {},
  selectedId: null,
  editingId: null,
  editingWorkspaceId: null,
  confirmAction: null,
  webcamStreams: new Map(),
  startedStreams: new Set(),
  streamUrls: new Map(),
  streamStates: new Map(),
  draggedId: null,
};
let toastTimer;

function showToast(title, message) {
  $("#toastTitle").textContent = title;
  $("#toastText").textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}
function uid() {
  return `cam_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}
function activeCameras() {
  return state.cameras
    .filter((camera) => camera.workspaceId === state.activeWorkspaceId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
function updateCounts() {
  const cameras = activeCameras();
  $("#cameraCount").textContent = cameras.length;
  $("#settingsCameraCount").textContent = cameras.length;
  for (const camera of cameras) {
    const status = cameraStatus(camera);
    const row = $(`.cam-row[data-camera-id="${CSS.escape(camera.id)}"]`);
    if (row) {
      row.querySelector(".cam-meta small span").textContent =
        status === "Live" ? "Online" : status;
      row
        .querySelector(".cam-meta small i")
        .classList.toggle("offline", status !== "Live");
    }
    const feed = $(`.feed[data-camera-id="${CSS.escape(camera.id)}"]`);
    if (feed) {
      feed.querySelector(".live-text").textContent = status;
      feed
        .querySelector(".cam-live")
        .classList.toggle("offline", status !== "Live");
    }
  }
}
function cameraStatus(camera) {
  if (camera.type === "webcam")
    return state.webcamStreams.has(camera.id) ? "Live" : "Connect";
  return state.streamStates.get(camera.id)?.status === "live"
    ? "Live"
    : state.streamStates.get(camera.id)?.status === "connecting"
      ? "Connecting"
      : "Offline";
}
function render() {
  state.cameras.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  renderWorkspaces();
  const cameras = activeCameras();
  if (!cameras.some((camera) => camera.id === state.selectedId))
    state.selectedId = cameras[0]?.id || null;
  const list = $("#cameraList");
  list.replaceChildren();
  for (const camera of cameras) {
    const row = document.createElement("div");
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.className = `cam-row${camera.id === state.selectedId ? " selected" : ""}`;
    row.dataset.cameraId = camera.id;
    row.innerHTML = `<span class="cam-thumb ${camera.type === "webcam" ? "thumb-webcam" : "thumb-rtsp"}">${icon(camera.type === "webcam" ? "video" : "cctv")}</span><span class="cam-meta"><strong></strong><small><i></i><span></span></small></span><span class="camera-actions"><button class="camera-edit" type="button" title="Edit camera" aria-label="Edit camera">${icon("ellipsis")}</button></span>`;
    row.querySelector(".cam-meta strong").textContent = camera.name;
    row.querySelector(".cam-meta small span").textContent =
      cameraStatus(camera);
    row
      .querySelector(".cam-meta small i")
      .classList.toggle("offline", cameraStatus(camera) !== "Live");
    row.addEventListener("click", (event) => {
      if (event.target.closest(".camera-edit")) return;
      selectCamera(camera.id);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCamera(camera.id);
      }
    });
    row.querySelector(".camera-edit").addEventListener("click", (event) => {
      event.stopPropagation();
      openCameraModal(camera);
    });
    list.append(row);
  }
  const grid = $("#feeds");
  grid.classList.remove("single");
  grid.replaceChildren();
  if (!cameras.length) {
    const empty = document.createElement("div");
    empty.className = "empty-cameras";
    empty.innerHTML = `<div class="empty-mark">${icon("video")}</div><h2>No cameras in this workplace</h2><p>Add an RTSP camera or a webcam to this workplace.</p><button class="add-camera" id="emptyAddCamera">${icon("plus")} Add camera</button>`;
    grid.append(empty);
    $("#emptyAddCamera").addEventListener("click", openCameraModal);
  } else {
    for (const camera of cameras) grid.append(createFeed(camera));
  }
  updateCounts();
  $$(".cam-row").forEach((row) =>
    row.classList.toggle("selected", row.dataset.cameraId === state.selectedId),
  );
  const addCameraButton = $("#addSmall");
  addCameraButton.disabled = false;
}
function renderWorkspaces() {
  const tabs = $("#workspaceTabs");
  tabs.replaceChildren();
  for (const workspace of state.workspaces) {
    const tab = document.createElement("div");
    tab.className = `workplace-tab${workspace.id === state.activeWorkspaceId ? " active" : ""}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute(
      "aria-selected",
      workspace.id === state.activeWorkspaceId ? "true" : "false",
    );
    tab.innerHTML = `<button type="button" class="workspace-select"></button><button type="button" class="workspace-menu" title="Workplace settings" aria-label="Workplace settings">${icon("ellipsis")}</button>`;
    tab.querySelector(".workspace-select").textContent = workspace.name;
    tab
      .querySelector(".workspace-select")
      .addEventListener("click", () => setActiveWorkspace(workspace.id));
    tab
      .querySelector(".workspace-select")
      .addEventListener("dblclick", () => openWorkspaceModal(workspace));
    tab.querySelector(".workspace-menu").addEventListener("click", (event) => {
      event.stopPropagation();
      openWorkspaceModal(workspace);
    });
    tabs.append(tab);
  }
}
async function setActiveWorkspace(id) {
  if (id === state.activeWorkspaceId) return;
  state.activeWorkspaceId = id;
  state.selectedId = null;
  stopInactiveStreams();
  const result = await api.saveWorkspaces(state.workspaces, id);
  state.activeWorkspaceId = result.activeWorkspaceId;
  render();
}
function stopInactiveStreams() {
  for (const camera of state.cameras.filter(
    (item) => item.workspaceId !== state.activeWorkspaceId,
  )) {
    if (camera.type === "rtsp" && state.startedStreams.has(camera.id)) {
      api.stopStream(camera.id);
      state.startedStreams.delete(camera.id);
      state.streamStates.set(camera.id, { status: "offline" });
    }
    const stream = state.webcamStreams.get(camera.id);
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      state.webcamStreams.delete(camera.id);
    }
  }
}
function createFeed(camera) {
  const feed = document.createElement("article");
  feed.className = `feed${camera.id === state.selectedId ? " selected-feed" : ""}`;
  feed.dataset.cameraId = camera.id;
  feed.draggable = activeCameras().length > 1;
  feed.innerHTML = `<div class="feed-media"></div><div class="feed-top"><span class="cam-live"><i></i><span class="live-text"></span></span><span class="hd">${camera.type === "webcam" ? "WEB" : "RTSP"}</span><button class="feed-expand" type="button" title="Expand inside window" aria-label="Expand camera inside window" aria-expanded="false">${icon("expand")}</button><button class="feed-fullscreen" type="button" title="Fullscreen camera" aria-label="Fullscreen camera">${icon("maximize-2")}</button><button class="feed-menu" type="button" title="Camera settings" aria-label="Camera settings">${icon("ellipsis")}</button></div><div class="feed-label"><strong></strong></div><div class="feed-time">--:--:--</div><div class="drag-hint" aria-hidden="true">${icon("grip-vertical")}</div>`;
  feed.querySelector(".feed-label strong").textContent = camera.name;
  feed.querySelector(".live-text").textContent = cameraStatus(camera);
  feed
    .querySelector(".cam-live")
    .classList.toggle("offline", cameraStatus(camera) !== "Live");
  feed.querySelector(".feed-menu").addEventListener("click", (event) => {
    event.stopPropagation();
    openCameraModal(camera);
  });
  feed.querySelector(".feed-fullscreen").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    enterCameraFullscreen(feed);
  });
  feed.querySelector(".feed-expand").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleCameraGridSize(feed);
  });
  feed.addEventListener("click", (event) => {
    if (!event.target.closest(".feed-menu")) selectCamera(camera.id);
  });
  feed.addEventListener("dragstart", (event) => {
    state.draggedId = camera.id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", camera.id);
    requestAnimationFrame(() => feed.classList.add("dragging"));
  });
  feed.addEventListener("dragend", () => {
    feed.classList.remove("dragging");
    $$(".feed").forEach((item) => item.classList.remove("drag-over"));
  });
  feed.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    feed.classList.add("drag-over");
  });
  feed.addEventListener("dragleave", () => feed.classList.remove("drag-over"));
  feed.addEventListener("drop", (event) => {
    event.preventDefault();
    feed.classList.remove("drag-over");
    reorderCameras(
      state.draggedId || event.dataTransfer.getData("text/plain"),
      camera.id,
    );
  });
  const host = feed.querySelector(".feed-media");
  if (camera.type === "webcam") attachWebcam(camera, host, feed);
  else if (camera.url) attachRtsp(camera, host, feed);
  else
    showFeedEmpty(
      host,
      "Add an RTSP URL in camera settings to connect this stream.",
    );
  return feed;
}
function showFeedEmpty(host, message, error = false) {
  host.replaceChildren();
  const placeholder = document.createElement("div");
  placeholder.className = `feed-empty${error ? " error" : ""}`;
  placeholder.innerHTML = `<span class="feed-empty-icon">${icon(error ? "circle-alert" : "video")}</span><span></span>`;
  placeholder.querySelector("span:last-child").textContent = message;
  host.append(placeholder);
}
async function attachRtsp(camera, host, feed, ensureStream = true) {
  const image = document.createElement("img");
  image.className = "live-image";
  image.alt = `${camera.name} live camera stream`;
  image.addEventListener("load", () => {
    feed.querySelector(".live-text").textContent = "Live";
    feed.querySelector(".cam-live").classList.remove("offline");
    state.streamStates.set(camera.id, { status: "live" });
    updateCounts();
  });
  image.addEventListener("error", () => {
    feed.querySelector(".live-text").textContent = "Connecting";
    feed.querySelector(".cam-live").classList.add("offline");
  });
  host.replaceChildren(image);
  try {
    const url = ensureStream
      ? await api.startStream(camera.id)
      : state.streamUrls.get(camera.id);
    if (!url) return;
    if (!host.isConnected) return;
    state.streamUrls.set(camera.id, url);
    image.src = `${url}?t=${Date.now()}`;
    state.startedStreams.add(camera.id);
  } catch (error) {
    showFeedEmpty(host, error.message || "Unable to start RTSP stream.", true);
  }
}
async function attachWebcam(camera, host, feed) {
  let stream = state.webcamStreams.get(camera.id);
  if (!stream) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: camera.deviceId
          ? { deviceId: { exact: camera.deviceId } }
          : true,
      });
      state.webcamStreams.set(camera.id, stream);
    } catch (error) {
      showFeedEmpty(
        host,
        error.name === "NotAllowedError"
          ? "Allow camera access in system privacy settings."
          : "Webcam unavailable. Check that it is connected.",
        true,
      );
      feed.querySelector(".live-text").textContent = "Offline";
      return;
    }
  }
  if (!host.isConnected) return;
  const video = document.createElement("video");
  video.className = "live-video";
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  host.replaceChildren(video);
  video.play().catch(() => {});
  feed.querySelector(".live-text").textContent = "Live";
  feed.querySelector(".cam-live").classList.remove("offline");
  updateCounts();
}
function selectCamera(id) {
  state.selectedId = id;
  $$(".feed").forEach((feed) =>
    feed.classList.toggle("selected-feed", feed.dataset.cameraId === id),
  );
  $$(".cam-row").forEach((row) =>
    row.classList.toggle("selected", row.dataset.cameraId === id),
  );
  updateGridExpandButtons();
}

function updateGridExpandButtons() {
  const grid = $("#feeds");
  $$(".feed-expand").forEach((button) => {
    const isExpanded =
      grid.classList.contains("single") &&
      button.closest(".feed")?.classList.contains("selected-feed");
    button.innerHTML = icon(isExpanded ? "minimize-2" : "expand");
    button.title = isExpanded ? "Restore camera grid" : "Expand inside window";
    button.setAttribute(
      "aria-label",
      isExpanded ? "Restore camera grid" : "Expand camera inside window",
    );
    button.setAttribute("aria-expanded", String(isExpanded));
  });
}

function toggleCameraGridSize(feed) {
  const grid = $("#feeds");
  const isExpanded =
    grid.classList.contains("single") &&
    feed.classList.contains("selected-feed");

  if (isExpanded) grid.classList.remove("single");
  else {
    selectCamera(feed.dataset.cameraId);
    grid.classList.add("single");
  }

  updateGridExpandButtons();
}
async function enterCameraFullscreen(
  feed = $(`.feed[data-camera-id="${CSS.escape(state.selectedId || "")}"]`),
) {
  if (!feed) {
    showToast("No camera selected", "Select a camera to open fullscreen.");
    return;
  }
  try {
    if (document.fullscreenElement === feed) {
      await document.exitFullscreen();
      return;
    }

    if (document.fullscreenElement) await document.exitFullscreen();
    await feed.requestFullscreen({ navigationUI: "hide" });
  } catch (error) {
    showToast(
      "Fullscreen unavailable",
      error.message || "Could not open this camera fullscreen.",
    );
  }
}

document.addEventListener("fullscreenchange", () => {
  $$(".feed-fullscreen").forEach((button) => {
    const isFullscreen = document.fullscreenElement === button.closest(".feed");
    button.innerHTML = icon(isFullscreen ? "minimize-2" : "maximize-2");
    button.title = isFullscreen ? "Exit fullscreen" : "Fullscreen camera";
    button.setAttribute(
      "aria-label",
      isFullscreen ? "Exit fullscreen" : "Fullscreen camera",
    );
  });
});
async function reorderCameras(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) return;
  const group = activeCameras();
  const source = group.findIndex((camera) => camera.id === sourceId);
  const target = group.findIndex((camera) => camera.id === targetId);
  if (source < 0 || target < 0) return;
  const [camera] = group.splice(source, 1);
  group.splice(target, 0, camera);
  const others = state.cameras.filter(
    (item) => item.workspaceId !== state.activeWorkspaceId,
  );
  state.cameras = [...others, ...group];
  state.cameras.forEach((item, index) => {
    item.sortOrder = index;
  });
  await api.saveCameras(state.cameras);
  for (const item of state.cameras) {
    const feed = $(`.feed[data-camera-id="${CSS.escape(item.id)}"]`);
    const row = $(`.cam-row[data-camera-id="${CSS.escape(item.id)}"]`);
    if (feed) $("#feeds").append(feed);
    if (row) $("#cameraList").append(row);
  }
  showToast("Camera order saved", "The grid order is saved on this computer.");
}
async function enumerateWebcams(requestPermission = true) {
  const select = $("#webcamDevice");
  select.replaceChildren(new Option("Choose a connected webcam", ""));
  try {
    if (!navigator.mediaDevices?.enumerateDevices)
      throw new Error("Camera access is not available in this environment.");
    if (requestPermission) {
      const permission = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      permission.getTracks().forEach((track) => track.stop());
    }
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "videoinput",
    );
    devices.forEach((device, index) =>
      select.add(
        new Option(device.label || `Webcam ${index + 1}`, device.deviceId),
      ),
    );
    if (!devices.length) select.add(new Option("No webcam found", ""));
    return devices.length;
  } catch (error) {
    $("#formError").textContent = error.message || "Could not list webcams.";
    return 0;
  }
}
function openCameraModal(camera = null) {
  state.editingId = camera?.id || null;
  $("#cameraForm").reset();
  $("#formError").textContent = "";
  $("#modalTitle").textContent = camera ? "Camera settings" : "Add a camera";
  $("#modalSubtitle").textContent = camera
    ? "Update this camera or remove it from the workspace."
    : "Connect an IP camera or a webcam on this computer.";
  $("#camName").value = camera?.name || "";
  $("#cameraType").value = camera?.type || "rtsp";
  $("#camUrl").value = camera?.url || "";
  const workspaceSelect = $("#camWorkspace");
  workspaceSelect.replaceChildren(
    ...state.workspaces.map(
      (workspace) => new Option(workspace.name, workspace.id),
    ),
  );
  workspaceSelect.value = camera?.workspaceId || state.activeWorkspaceId;
  $("#deleteCamera").hidden = !camera;
  $("#saveCamera").innerHTML = camera
    ? `Save changes <span>${icon("arrow-right")}</span>`
    : `Connect camera <span>${icon("arrow-right")}</span>`;
  setCameraTypeFields();
  cameraModal.classList.add("open");
  if (camera?.type === "webcam")
    enumerateWebcams(true).then(() => {
      $("#webcamDevice").value = camera.deviceId || "";
    });
  setTimeout(() => $("#camName").focus(), 40);
}
function closeCameraModal() {
  cameraModal.classList.remove("open");
  state.editingId = null;
}
function setCameraTypeFields() {
  const webcam = $("#cameraType").value === "webcam";
  $("#webcamFields").hidden = !webcam;
  $("#rtspFields").hidden = webcam;
}
async function saveCamera(event) {
  event.preventDefault();
  const name = $("#camName").value.trim();
  const type = $("#cameraType").value;
  const url = $("#camUrl").value.trim();
  const deviceId = $("#webcamDevice").value;
  if (!name) {
    $("#formError").textContent = "Enter a camera name.";
    return;
  }
  if (type === "rtsp" && !/^rtsps?:\/\//i.test(url)) {
    $("#formError").textContent = "Enter a valid rtsp:// or rtsps:// address.";
    return;
  }
  if (type === "webcam" && !deviceId) {
    $("#formError").textContent = "Choose a connected webcam.";
    return;
  }
  const existing = state.cameras.find(
    (camera) => camera.id === state.editingId,
  );
  const camera = {
    id: existing?.id || uid(),
    name,
    type,
    url: type === "rtsp" ? url : "",
    deviceId: type === "webcam" ? deviceId : "",
    workspaceId: $("#camWorkspace").value,
    sortOrder: existing?.sortOrder ?? state.cameras.length,
  };
  try {
    if (existing?.type === "webcam") {
      state.webcamStreams
        .get(existing.id)
        ?.getTracks()
        .forEach((track) => track.stop());
      state.webcamStreams.delete(existing.id);
    }
    if (existing?.type === "rtsp") {
      await api.stopStream(existing.id);
      state.startedStreams.delete(existing.id);
    }
    if (existing) state.cameras[state.cameras.indexOf(existing)] = camera;
    else state.cameras.push(camera);
    state.selectedId = camera.id;
    state.cameras.forEach((item, index) => {
      item.sortOrder = index;
    });
    state.cameras = await api.saveCameras(state.cameras);
    if (camera.workspaceId !== state.activeWorkspaceId) {
      const savedWorkspaceState = await api.saveWorkspaces(
        state.workspaces,
        camera.workspaceId,
      );
      state.activeWorkspaceId = savedWorkspaceState.activeWorkspaceId;
    }
    stopInactiveStreams();
    closeCameraModal();
    render();
    showToast(
      existing ? "Camera updated" : "Camera added",
      `${camera.name} is saved on this computer.`,
    );
  } catch (error) {
    $("#formError").textContent = error.message || "Unable to save camera.";
  }
}
function askDelete() {
  const camera = state.cameras.find((item) => item.id === state.editingId);
  if (!camera) return;
  $("#confirmTitle").textContent = "Delete this camera?";
  $("#confirmText").textContent =
    `“${camera.name}” will be removed from this computer.`;
  state.confirmAction = deleteCamera;
  $("#confirmModal").classList.add("open");
}
function openWorkspaceModal(workspace = null) {
  state.editingWorkspaceId = workspace?.id || null;
  $("#workspaceForm").reset();
  $("#workspaceError").textContent = "";
  $("#workspaceModalTitle").textContent = workspace
    ? "Rename workplace"
    : "New workplace";
  $("#workspaceModalSubtitle").textContent = workspace
    ? "Change the name shown on its tab."
    : "Create a tab to group cameras by site or area.";
  $("#workspaceName").value = workspace?.name || "";
  $("#saveWorkspace").textContent = workspace
    ? "Save name"
    : "Create workplace";
  $("#deleteWorkspace").hidden = !workspace;
  $("#workspaceModal").classList.add("open");
  setTimeout(() => $("#workspaceName").focus(), 40);
}
function closeWorkspaceModal() {
  $("#workspaceModal").classList.remove("open");
  state.editingWorkspaceId = null;
}
async function saveWorkspace(event) {
  event.preventDefault();
  const name = $("#workspaceName").value.trim();
  if (!name) {
    $("#workspaceError").textContent = "Enter a workplace name.";
    return;
  }
  const existing = state.workspaces.find(
    (item) => item.id === state.editingWorkspaceId,
  );
  const workspaces = existing
    ? state.workspaces.map((item) =>
        item.id === existing.id ? { ...item, name } : item,
      )
    : [...state.workspaces, { id: uid().replace("cam_", "ws_"), name }];
  try {
    const result = await api.saveWorkspaces(
      workspaces,
      existing ? state.activeWorkspaceId : workspaces.at(-1).id,
    );
    state.workspaces = result.workspaces;
    state.activeWorkspaceId = result.activeWorkspaceId;
    state.selectedId = null;
    stopInactiveStreams();
    closeWorkspaceModal();
    render();
    showToast(
      existing ? "Workplace renamed" : "Workplace created",
      `${name} is ready.`,
    );
  } catch (error) {
    $("#workspaceError").textContent =
      error.message || "Could not save this workplace.";
  }
}
function askDeleteWorkspace() {
  const workplace = state.workspaces.find(
    (item) => item.id === state.editingWorkspaceId,
  );
  if (!workplace) return;
  const destination = state.workspaces.find((item) => item.id !== workplace.id);
  const camerasHere = state.cameras.filter(
    (camera) => camera.workspaceId === workplace.id,
  ).length;
  const fallbackName = destination?.name || "My workspace";
  $("#confirmTitle").textContent = "Delete this workplace?";
  $("#confirmText").textContent = camerasHere
    ? `${camerasHere} camera${camerasHere === 1 ? "" : "s"} will move to “${fallbackName}”.`
    : `“${workplace.name}” will be removed.`;
  state.confirmAction = () => deleteWorkspace(workplace.id);
  $("#confirmModal").classList.add("open");
}
async function deleteWorkspace(id) {
  const workplace = state.workspaces.find((item) => item.id === id);
  if (!workplace) return;
  const destination = state.workspaces.find((item) => item.id !== id) || {
    id: uid().replace("cam_", "ws_"),
    name: "My workspace",
  };
  const hasDestination = state.workspaces.some(
    (item) => item.id === destination.id,
  );
  const workspacesWithDestination = hasDestination
    ? state.workspaces
    : [...state.workspaces, destination];
  try {
    if (!hasDestination) {
      const interim = await api.saveWorkspaces(
        workspacesWithDestination,
        destination.id,
      );
      state.workspaces = interim.workspaces;
    }
    state.cameras = state.cameras.map((camera) =>
      camera.workspaceId === id
        ? { ...camera, workspaceId: destination.id }
        : camera,
    );
    state.cameras.forEach((camera, index) => {
      camera.sortOrder = index;
    });
    state.cameras = await api.saveCameras(state.cameras);
    const remaining = state.workspaces.filter((item) => item.id !== id);
    const activeId =
      state.activeWorkspaceId === id ? destination.id : state.activeWorkspaceId;
    const result = await api.saveWorkspaces(remaining, activeId);
    state.workspaces = result.workspaces;
    state.activeWorkspaceId = result.activeWorkspaceId;
    $("#confirmModal").classList.remove("open");
    closeWorkspaceModal();
    state.selectedId = null;
    stopInactiveStreams();
    render();
    showToast(
      "Workplace deleted",
      `Cameras were kept in “${destination.name}”.`,
    );
  } catch (error) {
    $("#workspaceError").textContent =
      error.message || "Could not delete this workplace.";
    $("#confirmModal").classList.remove("open");
  }
}
async function deleteCamera() {
  const camera = state.cameras.find((item) => item.id === state.editingId);
  if (!camera) return;
  if (camera.type === "rtsp") {
    await api.stopStream(camera.id);
    state.startedStreams.delete(camera.id);
  }
  state.webcamStreams
    .get(camera.id)
    ?.getTracks()
    .forEach((track) => track.stop());
  state.webcamStreams.delete(camera.id);
  state.cameras = state.cameras.filter((item) => item.id !== camera.id);
  state.cameras.forEach((item, index) => {
    item.sortOrder = index;
  });
  state.cameras = await api.saveCameras(state.cameras);
  state.selectedId = state.cameras[0]?.id || null;
  $("#confirmModal").classList.remove("open");
  closeCameraModal();
  render();
  showToast("Camera deleted", `${camera.name} was removed.`);
}
async function loadSettings() {
  const saved = await api.load();
  state.settings = saved.settings;
  $("#ffmpegPath").value = state.settings.ffmpegPath || "ffmpeg";
  $("#streamQuality").value = state.settings.streamQuality || "balanced";
  $("#autoReconnect").checked = state.settings.autoReconnect !== false;
}
let settingsSaveTimer;
function saveSettings() {
  clearTimeout(settingsSaveTimer);
  $("#settingsSaved").textContent = "Saving…";
  settingsSaveTimer = setTimeout(async () => {
    try {
      state.settings = await api.saveSettings({
        ffmpegPath: $("#ffmpegPath").value.trim() || "ffmpeg",
        streamQuality: $("#streamQuality").value,
        autoReconnect: $("#autoReconnect").checked,
      });
      $("#settingsSaved").textContent = "Settings saved";
    } catch {
      $("#settingsSaved").textContent = "Could not save settings";
    }
  }, 250);
}
function showPage(page) {
  const settings = page === "settings";
  $("#dashboardPage").hidden = settings;
  $("#settingsPage").hidden = !settings;
  $$(".nav-item").forEach((button) =>
    button.classList.toggle("active", button.dataset.page === page),
  );
}

$("#addSmall").addEventListener("click", () => openCameraModal());
$("#cameraForm").addEventListener("submit", saveCamera);
$("#modalClose").addEventListener("click", closeCameraModal);
$("#cancelModal").addEventListener("click", closeCameraModal);
cameraModal.addEventListener("click", (event) => {
  if (event.target === cameraModal) closeCameraModal();
});
$("#cameraType").addEventListener("change", async () => {
  setCameraTypeFields();
  if ($("#cameraType").value === "webcam") await enumerateWebcams(true);
});
$("#refreshDevices").addEventListener("click", () => enumerateWebcams(true));
$("#deleteCamera").addEventListener("click", askDelete);
$("#workspaceForm").addEventListener("submit", saveWorkspace);
$("#addWorkspace").addEventListener("click", () => openWorkspaceModal());
$("#workspaceModalClose").addEventListener("click", closeWorkspaceModal);
$("#cancelWorkspace").addEventListener("click", closeWorkspaceModal);
$("#workspaceModal").addEventListener("click", (event) => {
  if (event.target.id === "workspaceModal") closeWorkspaceModal();
});
$("#deleteWorkspace").addEventListener("click", askDeleteWorkspace);
$("#cancelDelete").addEventListener("click", () =>
  $("#confirmModal").classList.remove("open"),
);
$("#confirmDelete").addEventListener("click", async () => {
  const action = state.confirmAction;
  state.confirmAction = null;
  $("#confirmModal").classList.remove("open");
  if (action) await action();
});
$$(".nav-item").forEach((button) =>
  button.addEventListener("click", () => showPage(button.dataset.page)),
);
$("#ffmpegPath").addEventListener("change", saveSettings);
$("#streamQuality").addEventListener("change", saveSettings);
$("#autoReconnect").addEventListener("change", saveSettings);
$("#checkFfmpeg").addEventListener("click", async () => {
  $("#ffmpegResult").textContent = "Checking…";
  const result = await api.checkFfmpeg(
    $("#ffmpegPath").value.trim() || "ffmpeg",
  );
  $("#ffmpegResult").textContent = result.ok
    ? `Ready · ${result.version}`
    : `FFmpeg was not found: ${result.message}`;
});
$("#manageCameras").addEventListener("click", () => {
  showPage("dashboard");
  $("#dashboardPage").hidden = false;
  $("#settingsPage").hidden = true;
  setTimeout(
    () =>
      $("#cameraList").scrollIntoView({ behavior: "smooth", block: "center" }),
    50,
  );
});
$("#resetSettings").addEventListener("click", async () => {
  $("#ffmpegPath").value = "ffmpeg";
  $("#streamQuality").value = "balanced";
  $("#autoReconnect").checked = true;
  saveSettings();
  showToast(
    "Defaults restored",
    "Streaming settings are back to their defaults.",
  );
});
$("#toastClose").addEventListener("click", () =>
  toast.classList.remove("show"),
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if ($("#feeds").classList.contains("single")) {
      $("#feeds").classList.remove("single");
      updateGridExpandButtons();
    }
    closeCameraModal();
    closeWorkspaceModal();
    $("#confirmModal").classList.remove("open");
  }
});
api?.onStreamStatus?.(({ id, status, message }) => {
  state.streamStates.set(id, { status, message });
  const feed = $(`.feed[data-camera-id="${CSS.escape(id)}"]`);
  if (feed && status === "connecting") {
    const camera = state.cameras.find((item) => item.id === id);
    if (camera?.url && !feed.querySelector(".live-image"))
      attachRtsp(camera, feed.querySelector(".feed-media"), feed, false);
    else if (feed.querySelector(".live-image") && state.streamUrls.has(id))
      feed.querySelector(".live-image").src =
        `${state.streamUrls.get(id)}?t=${Date.now()}`;
  }
  if (
    feed &&
    status === "error" &&
    !feed.querySelector(".live-image")?.naturalWidth
  )
    showFeedEmpty(
      feed.querySelector(".feed-media"),
      message || "Could not connect to this camera.",
      true,
    );
  if (feed && status !== "live") {
    const liveText = feed.querySelector(".live-text");
    if (liveText) {
      liveText.textContent = status === "connecting" ? "Connecting" : "Offline";
      feed.querySelector(".cam-live").classList.add("offline");
    }
  }
  updateCounts();
});

async function init() {
  const requiredBridgeMethods = [
    "load",
    "saveCameras",
    "saveWorkspaces",
    "saveSettings",
    "startStream",
    "stopStream",
    "checkFfmpeg",
    "onStreamStatus",
  ];
  const bridgeReady =
    api &&
    requiredBridgeMethods.every((method) => typeof api[method] === "function");
  if (!bridgeReady) {
    $("#cameraCount").textContent = "—";
    $("#feeds").innerHTML =
      '<div class="empty-cameras bridge-error"><div class="empty-mark">!</div><h2>Open the desktop app</h2><p>Camera setup and live streams need the Electron desktop process. Close this browser window and launch the app with <code>npm start</code>.</p></div>';
    $("#addWorkspace").disabled = true;
    $("#addSmall").disabled = true;
    $("#settingsCameraCount").textContent = "—";
    return;
  }
  try {
    const saved = await api.load();
    state.cameras = saved.cameras || [];
    state.workspaces = saved.workspaces || [
      { id: "workspace-main", name: "My workspace" },
    ];
    state.activeWorkspaceId = saved.activeWorkspaceId || state.workspaces[0].id;
    state.settings = saved.settings || {};
  } catch (error) {
    showToast(
      "Storage unavailable",
      error.message || "Could not read saved camera settings.",
    );
  }
  await loadSettings();
  render();
}
init();
