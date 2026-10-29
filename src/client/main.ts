import * as THREE from 'three';
import { areaFor, SEAT_COLORS, seatPoint, STAGES, STAGE_COLORS, type Action, type Chip, type Snapshot } from '../shared/types';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('table');
const joinDialog = el<HTMLDialogElement>('join-dialog');
const readyButton = el<HTMLButtonElement>('ready');
joinDialog.addEventListener('cancel', event => event.preventDefault());
let state: Snapshot | null = null;
let socket: WebSocket | null = null;
let token = readStorage('gang-seat');
let displayName = readStorage('gang-name') || '';
let watch = false;
let stopped = false;
let retry = 0;
let reconnectTimer: ReturnType<typeof setTimeout>;
let toastTimer: ReturnType<typeof setTimeout>;
function readStorage(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function store(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* The session still works without browser storage. */ } }
function toast(message: string) { el('toast').textContent = message; el('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el('toast').classList.remove('show'), 3500); }
function send(action: Action | { type: 'ping' }) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(action)); }
function online(value: boolean, message?: string) {
  el('connection-dot').classList.toggle('online', value);
  el('connection').textContent = message || (value ? 'At the table' : 'Reconnecting…');
  readyButton.disabled = !value || readyButton.disabled;
  el<HTMLButtonElement>('again').disabled = !value;
}
function connect() {
  clearTimeout(reconnectTimer);
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  const current = socket;
  current.onopen = () => { retry = 0; current.send(JSON.stringify({ type: 'join', name: displayName, token, watch })); };
  current.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'welcome') {
      token = message.token; store('gang-seat', token!); online(true); joinDialog.close();
      if (!message.restored && state) toast('The previous table ended. You’ve joined a fresh table.');
    }
    if (message.type === 'grab-result' && dragging?.id === message.chip && !message.accepted) {
      cancelDrag(false); toast('Someone else has that chip.');
    }
    if (message.type === 'state') {
      const previous = state; state = message.state;
      if (dragging && previous && JSON.stringify(previous.players.map(p => [p.id, p.seat])) !== JSON.stringify(state!.players.map(p => [p.id, p.seat]))) cancelDrag(false);
      if (dragging && (state!.phase !== 'playing' || state!.chips.find(c => c.id === dragging!.id)?.holder !== state!.selfId)) {
        if (performance.now() - dragging.started > 500 || state!.phase !== 'playing') cancelDrag(false);
      }
      updateScene(previous); updateUI();
      if (previous && previous.stage !== state!.stage) toast(`${STAGES[state!.stage]} · Find your place again`);
    }
  };
  current.onclose = event => {
    if (current !== socket) return;
    cancelDrag(false); online(false);
    if (event.code === 4001) { stopped = true; online(false, 'Open in another tab'); toast('Your seat is active in another tab. Refresh to return here.'); return; }
    if (!stopped) reconnectTimer = setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
  };
  current.onerror = () => current.close();
}
el<HTMLFormElement>('join-form').addEventListener('submit', event => {
  event.preventDefault(); displayName = el<HTMLInputElement>('name').value.trim();
  if (!displayName) return;
  store('gang-name', displayName); watch = el<HTMLInputElement>('watch').checked;
  el<HTMLButtonElement>('join-form').querySelector<HTMLButtonElement>('button')!.textContent = 'Joining…';
  connect();
});
el<HTMLInputElement>('name').value = displayName;
el('help-button').onclick = () => el<HTMLDialogElement>('help-dialog').showModal();
el('close-help').onclick = () => el<HTMLDialogElement>('help-dialog').close();
readyButton.onclick = () => {
  const self = state?.players.find(p => p.id === state!.selfId);
  if (self) send({ type: 'ready', value: self.readyChip === null });
};
readyButton.setAttribute('aria-keyshortcuts', 'Space');
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (readyButton.disabled || readyButton.hidden || document.querySelector('dialog[open]')) return;
  const target = event.target;
  if (target instanceof HTMLElement && target !== readyButton && (target.isContentEditable || target.closest('input, textarea, select, button, a, [role="button"], [role="textbox"]'))) return;
  event.preventDefault();
  if (!event.repeat) readyButton.click();
});
el('again').onclick = () => send({ type: 'again' });
el('sit').onclick = () => send({ type: 'sit' });
el('leave').onclick = () => { cancelDrag(); send({ type: 'leave' }); };
setInterval(() => { send({ type: 'ping' }); if (dragging) send({ type: 'move', chip: dragging.id, ...dragging.point }); }, 3000);

function cardElement(card: string) {
  const node = document.createElement('div'); node.className = 'card';
  if (card === '??') { node.classList.add('back'); node.setAttribute('aria-label', 'Hidden card'); return node; }
  const suits: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
  node.textContent = card[0] === 'T' ? '10' : card[0];
  if ('dh'.includes(card[1])) node.classList.add('red');
  const suit = document.createElement('span'); suit.textContent = suits[card[1]]; node.append(suit);
  node.setAttribute('aria-label', `${node.firstChild!.textContent} ${suits[card[1]]}`); return node;
}
function updateUI() {
  if (!state) return;
  const self = state.players.find(p => p.id === state!.selfId);
  const count = state.players.filter(p => p.readyChip !== null).length;
  const owned = state.chips.filter(c => areaFor(c, state!.players) === state!.selfId);
  const connected = socket?.readyState === WebSocket.OPEN;
  const finished = state.phase === 'reveal';
  el('stage-track').replaceChildren(...STAGES.map((stage, i) => {
    const node = document.createElement('div'); node.className = `stage-step ${i === state!.stage ? 'active' : ''} ${i < state!.stage || finished ? 'done' : ''}`;
    node.style.setProperty('--stage', STAGE_COLORS[i]); const dot = document.createElement('i'); node.append(dot, stage); return node;
  }));
  el('hand').replaceChildren(...(self?.cards || []).map(cardElement));
  el('hand-label').textContent = self ? finished ? 'YOUR REVEALED HAND' : 'YOUR PRIVATE HAND' : 'SPECTATOR';
  el('spectating').hidden = !!self;
  el<HTMLButtonElement>('sit').hidden = !state.canSit;
  el<HTMLButtonElement>('leave').hidden = !self || state.stage !== 0 || state.phase !== 'playing';
  el<HTMLButtonElement>('leave').disabled = !connected;
  el('instruction-title').textContent = finished ? 'Every hand tells a story.' : 'No words. Just chips.';
  el('instruction-detail').textContent = finished ? 'Your river chips are your final ranking.' : `1 = weakest · ${state.players.length || 'N'} = strongest · Move any released chip`;
  el('ready-count').textContent = finished ? `${state.players.length} players · ${state.spectators} watching` : `${count} / ${state.players.length} ready${state.players.some(p => !p.connected) ? ' · Waiting for a connection' : ''}`;
  readyButton.hidden = finished || !self;
  readyButton.disabled = !connected || state.phase !== 'playing' || owned.length !== 1;
  readyButton.classList.toggle('confirmed', self?.readyChip != null);
  readyButton.textContent = self?.readyChip != null ? 'Ready · Undo ↶' : owned.length === 1 ? `Ready with ${owned[0].id} ✓` : 'Take one chip to ready';
  el('again').hidden = !finished || !self;
  el<HTMLButtonElement>('again').disabled = !connected;
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-9, 9, 9, -9, .1, 100);
camera.position.set(0, 22, 14); camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight('#d5f8f1', '#14242c', 1.6));
const light = new THREE.DirectionalLight('#fff3d6', 2.0); light.position.set(-5, 14, 6); light.castShadow = true;
light.shadow.mapSize.set(2048, 2048); light.shadow.camera.left = -9; light.shadow.camera.right = 9; light.shadow.camera.top = 9; light.shadow.camera.bottom = -9; light.shadow.normalBias = .04; scene.add(light);
const table = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.5, .38, 96), new THREE.MeshStandardMaterial({ color: '#1c3036', roughness: .65 }));
table.position.y = -.3; table.receiveShadow = true; scene.add(table);
const rail = new THREE.Mesh(new THREE.TorusGeometry(6.25, .2, 12, 96), new THREE.MeshStandardMaterial({ color: '#334e50', roughness: .6 })); rail.rotation.x = -Math.PI / 2; rail.position.y = -.05; scene.add(rail);
const felt = new THREE.Mesh(new THREE.CircleGeometry(6.16, 96), new THREE.MeshStandardMaterial({ color: '#17413e', roughness: 1 })); felt.rotation.x = -Math.PI / 2; felt.position.y = -.08; felt.receiveShadow = true; scene.add(felt);
const staticGroup = new THREE.Group(); scene.add(staticGroup);
const chipGroup = new THREE.Group(); scene.add(chipGroup);
const chipMeshes = new Map<number, THREE.Group>();
let sceneSignature = '';
function disposeGroup(group: THREE.Group) {
  group.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) { if ('map' in material) (material.map as THREE.Texture | null)?.dispose(); material.dispose(); }
    }
  });
  group.clear();
}
function sprite(text: string, color: string, width: number, height: number, background?: string): THREE.Sprite {
  const surface = document.createElement('canvas'); surface.width = 512; surface.height = 128;
  const context = surface.getContext('2d')!;
  if (background) { context.fillStyle = background; context.beginPath(); context.roundRect(0, 0, 512, 128, 28); context.fill(); }
  context.fillStyle = color; context.font = '600 48px system-ui, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(text, 256, 64, 475);
  const texture = new THREE.CanvasTexture(surface); texture.colorSpace = THREE.SRGBColorSpace;
  const result = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })); result.scale.set(width, height, 1); return result;
}
function tableCard(card?: string): THREE.Mesh {
  const surface = document.createElement('canvas'); surface.width = 140; surface.height = 196;
  const ctx = surface.getContext('2d')!;
  if (!card) {
    ctx.strokeStyle = '#68908d'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.roundRect(5, 5, 130, 186, 12); ctx.stroke();
  } else {
    ctx.fillStyle = '#f4f0e5'; ctx.beginPath(); ctx.roundRect(3, 3, 134, 190, 12); ctx.fill();
    ctx.fillStyle = 'dh'.includes(card[1]) ? '#c15c67' : '#253c45'; ctx.font = 'bold 43px system-ui'; ctx.fillText(card[0] === 'T' ? '10' : card[0], 15, 53);
    ctx.font = '75px serif'; ctx.textAlign = 'center'; ctx.fillText(({ c: '♣', d: '♦', h: '♥', s: '♠' } as Record<string,string>)[card[1]], 74, 151);
  }
  const texture = new THREE.CanvasTexture(surface); texture.colorSpace = THREE.SRGBColorSpace;
  const result = new THREE.Mesh(new THREE.PlaneGeometry(.65, .91), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  result.rotation.x = -Math.PI / 2; return result;
}
function makeChip(id: number, stage: number, locked = false) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.37, .37, .15, 40), new THREE.MeshStandardMaterial({ color: STAGE_COLORS[stage], roughness: .48, metalness: .08 })); body.castShadow = true; body.receiveShadow = true; group.add(body);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(.065, .018, .09), new THREE.MeshStandardMaterial({ color: '#fffae4' }));
    stripe.position.set(Math.sin(angle) * .31, .085, Math.cos(angle) * .31); stripe.rotation.y = angle; group.add(stripe);
  }
  const numberCanvas = document.createElement('canvas'); numberCanvas.width = numberCanvas.height = 128;
  const numberContext = numberCanvas.getContext('2d')!;
  numberContext.fillStyle = '#203239'; numberContext.font = 'bold 88px system-ui'; numberContext.textAlign = 'center'; numberContext.textBaseline = 'middle'; numberContext.fillText(String(id), 64, 66, 118);
  const numberTexture = new THREE.CanvasTexture(numberCanvas); numberTexture.colorSpace = THREE.SRGBColorSpace;
  const number = new THREE.Mesh(new THREE.PlaneGeometry(.43, .43), new THREE.MeshBasicMaterial({ map: numberTexture, transparent: true, depthTest: true, depthWrite: false }));
  number.position.y = .077; number.rotation.set(-Math.PI / 2, 0, viewAngle); number.userData.chipNumber = true; group.add(number);
  if (!locked) {
    const hit = new THREE.Mesh(new THREE.SphereGeometry(.49, 10, 8), new THREE.MeshBasicMaterial({ visible: false })); hit.userData.chipId = id; group.add(hit);
  } else group.scale.setScalar(.65);
  group.userData.chipId = locked ? undefined : id;
  return group;
}
let viewAngle = 0;
const seatAngles = new Map<string, number>();
let layoutTween: { started: number; seats: Map<string, { from: number; to: number }>; viewFrom: number; viewTo: number; chips: Map<number, { x: number; z: number; angle: number }> } | null = null;
function nearestAngle(from: number, to: number) {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
}
function updateScene(previous: Snapshot | null) {
  if (!state) return;
  const self = state.players.find(p => p.id === state!.selfId);
  const targetView = (self?.seat ?? 0) * Math.PI * 2 / Math.max(1, state.players.length);
  const layoutChanged = previous && JSON.stringify(previous.players.map(p => [p.id, p.seat])) !== JSON.stringify(state.players.map(p => [p.id, p.seat]));
  if (layoutChanged && !reducedMotion) {
    const seats = new Map<string, { from: number; to: number }>();
    for (const player of state.players) {
      const target = player.seat * Math.PI * 2 / state.players.length;
      const from = seatAngles.get(player.id) ?? target;
      seats.set(player.id, { from, to: nearestAngle(from, target) });
    }
    const chips = new Map<number, { x: number; z: number; angle: number }>();
    for (const chip of previous.chips) {
      const owner = areaFor(chip, previous.players);
      const motion = owner ? seats.get(owner) : undefined;
      const mesh = chipMeshes.get(chip.id);
      if (motion && mesh) chips.set(chip.id, { x: mesh.position.x, z: mesh.position.z, angle: motion.to - motion.from });
    }
    layoutTween = { started: performance.now(), seats, viewFrom: viewAngle, viewTo: nearestAngle(viewAngle, targetView), chips };
  } else if (!previous || reducedMotion) {
    layoutTween = null; viewAngle = targetView;
  }
  for (const player of state.players) {
    if (!layoutTween?.seats.has(player.id)) seatAngles.set(player.id, player.seat * Math.PI * 2 / state.players.length);
  }
  for (const id of seatAngles.keys()) if (!state.players.some(p => p.id === id)) seatAngles.delete(id);
  const signature = JSON.stringify([state.stage, state.phase, state.maxPlayers, state.board, state.players.map(p => [p.id, p.seat, p.name, p.readyChip, p.connected, p.cards, p.history])]);
  if (signature !== sceneSignature) {
    sceneSignature = signature; disposeGroup(staticGroup);
    for (const player of state.players) {
      const seatGroup = new THREE.Group();
      seatGroup.userData.playerId = player.id;
      staticGroup.add(seatGroup);
      const i = player.seat;
      const point = seatPoint(i, state.players.length); const angle = i * Math.PI * 2 / state.players.length;
      const color = SEAT_COLORS[i % SEAT_COLORS.length];
      const zone = new THREE.Mesh(new THREE.RingGeometry(1.10, 1.12, 64), new THREE.MeshBasicMaterial({ color: player.readyChip != null ? '#9af0ca' : color, transparent: true, opacity: .7, side: THREE.DoubleSide }));
      zone.rotation.x = -Math.PI / 2; zone.position.set(point.x, -.055, point.z); seatGroup.add(zone);
      const inside = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), new THREE.MeshBasicMaterial({ color: player.readyChip != null ? '#83e5c1' : color, transparent: true, opacity: .045 })); inside.rotation.x = -Math.PI / 2; inside.position.set(point.x, -.06, point.z); seatGroup.add(inside);
      const namePoint = seatPoint(i, state.players.length, 6.08);
      const label = sprite(`${player.name}${player.id === state.selfId ? ' · YOU' : ''}${!player.connected ? ' · OFFLINE' : player.readyChip != null ? ' · ✓' : ''}`, player.connected ? '#e3ede5' : '#df9b94', 2.6, .6, '#18383ce8');
      label.position.set(namePoint.x, .25, namePoint.z); seatGroup.add(label);
      player.history.forEach((id, stage) => {
        const history = makeChip(id, stage, true); const center = seatPoint(i, state!.players.length, 5.08); const offset = (stage - 1.5) * .5;
        history.position.set(center.x + Math.cos(angle) * offset, .1, center.z - Math.sin(angle) * offset);
        if (state!.phase === 'transition' && stage === state!.stage && !reducedMotion) {
          const source = chipMeshes.get(id);
          if (source) {
            history.userData.destination = history.position.clone();
            history.position.copy(source.position); history.scale.setScalar(1);
          }
        }
        seatGroup.add(history);
      });
    }
    for (let i = 0; i < 5; i++) {
      const boardCard = tableCard(state.board[i]);
      // Community cards face the viewing seat, without changing table coordinates.
      const offset = (i - 2) * 1.22;
      boardCard.position.set(offset, -.045, 0); boardCard.scale.multiplyScalar(1.65); boardCard.userData.boardOffset = offset; staticGroup.add(boardCard);
    }
  }
  const chipSignature = `${state.stage}:${state.phase}`;
  if (chipGroup.userData.signature !== chipSignature) {
    disposeGroup(chipGroup); chipMeshes.clear(); chipGroup.userData.signature = chipSignature;
  }
  for (const [id, mesh] of chipMeshes) {
    if (!state.chips.some(chip => chip.id === id)) {
      chipGroup.remove(mesh); disposeGroup(mesh); chipMeshes.delete(id);
    }
  }
  const active = state.phase === 'playing';
  for (const chip of state.chips) {
    if (!active) continue;
    let mesh = chipMeshes.get(chip.id);
    if (!mesh) { mesh = makeChip(chip.id, state.stage); mesh.position.set(chip.x, .12, chip.z); chipGroup.add(mesh); chipMeshes.set(chip.id, mesh); }
    if (mesh.userData.holder !== chip.holder) {
      const old = mesh.children.find(child => child.name === 'controller');
      if (old) { mesh.remove(old); const wrapper = new THREE.Group(); wrapper.add(old); disposeGroup(wrapper); }
      if (chip.holder) {
        const holder = state.players.find(p => p.id === chip.holder);
        if (holder) { const marker = sprite(`● ${holder.name.slice(0, 10)}`, SEAT_COLORS[holder.seat % SEAT_COLORS.length], 1.25, .31, '#152d36ee'); marker.name = 'controller'; marker.position.y = .66; mesh.add(marker); }
      }
      mesh.userData.holder = chip.holder;
    }
  }
}
const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let dragging: { id: number; pointer: number; point: { x: number; z: number }; started: number; offset: { x: number; z: number } } | null = null;
function pointerWorld(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera);
  const intersection = new THREE.Vector3(); return raycaster.ray.intersectPlane(plane, intersection);
}
function cancelDrag(release = true) {
  if (!dragging) return;
  if (release) send({ type: 'release', chip: dragging.id });
  if (canvas.hasPointerCapture(dragging.pointer)) canvas.releasePointerCapture(dragging.pointer);
  dragging = null; canvas.style.cursor = 'grab';
}
canvas.addEventListener('pointerdown', event => {
  if (layoutTween || dragging || !state || state.phase !== 'playing' || socket?.readyState !== WebSocket.OPEN || !state.players.some(p => p.id === state!.selfId)) return;
  const point = pointerWorld(event); if (!point) return;
  const hits = raycaster.intersectObjects(chipGroup.children, true);
  const hit = hits.find(h => h.object.userData.chipId !== undefined || h.object.parent?.userData.chipId !== undefined);
  let id = hit?.object.userData.chipId ?? hit?.object.parent?.userData.chipId;
  if (!id && event.pointerType === 'touch') {
    const rect = canvas.getBoundingClientRect();
    let nearest = 27;
    for (const [chipId, mesh] of chipMeshes) {
      const projected = mesh.position.clone().project(camera);
      const x = rect.left + (projected.x + 1) * rect.width / 2;
      const y = rect.top + (1 - projected.y) * rect.height / 2;
      const distance = Math.hypot(event.clientX - x, event.clientY - y);
      if (distance < nearest) { nearest = distance; id = chipId; }
    }
  }
  if (!id) return;
  const chip = state.chips.find(c => c.id === id)!;
  if (chip.holder && chip.holder !== state.selfId) { toast('Wait until that chip is released.'); return; }
  event.preventDefault();
  dragging = { id, pointer: event.pointerId, point: { x: chip.x, z: chip.z }, started: performance.now(), offset: { x: chip.x - point.x, z: chip.z - point.z } };
  canvas.setPointerCapture(event.pointerId); canvas.style.cursor = 'grabbing'; send({ type: 'grab', chip: id });
});
let lastMoveSent = 0;
canvas.addEventListener('pointermove', event => {
  if (!dragging || dragging.pointer !== event.pointerId) return;
  const point = pointerWorld(event); if (!point) return;
  let x = point.x + dragging.offset.x; let z = point.z + dragging.offset.z;
  const length = Math.hypot(x, z); if (length > 5.6) { x *= 5.6 / length; z *= 5.6 / length; }
  dragging.point = { x, z };
  if (performance.now() - lastMoveSent > 30) { send({ type: 'move', chip: dragging.id, x, z }); lastMoveSent = performance.now(); }
});
canvas.addEventListener('pointerup', event => { if (dragging?.pointer === event.pointerId) { send({ type: 'move', chip: dragging.id, ...dragging.point }); cancelDrag(); } });
canvas.addEventListener('pointercancel', () => cancelDrag());
canvas.addEventListener('lostpointercapture', () => cancelDrag());
window.addEventListener('blur', () => cancelDrag());
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelDrag(); });
canvas.style.cursor = 'grab';
function resize() {
  const { width, height } = canvas.getBoundingClientRect();
  renderer.setSize(width, height, false);
  const aspect = width / Math.max(height, 1);
  const halfHeight = Math.max(7.5, 8.2 / aspect);
  camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect; camera.top = halfHeight; camera.bottom = -halfHeight; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas); resize();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let lastFrame = performance.now();
function animate(now: number) {
  const blend = reducedMotion ? 1 : 1 - Math.exp(-Math.min(now - lastFrame, 100) / 70); lastFrame = now;
  let layoutProgress = 1;
  if (layoutTween) {
    const progress = Math.min(1, (now - layoutTween.started) / 400);
    layoutProgress = progress * progress * (3 - 2 * progress);
    for (const [id, motion] of layoutTween.seats) seatAngles.set(id, THREE.MathUtils.lerp(motion.from, motion.to, layoutProgress));
    viewAngle = THREE.MathUtils.lerp(layoutTween.viewFrom, layoutTween.viewTo, layoutProgress);
  }
  camera.position.set(Math.sin(viewAngle) * 14, 22, Math.cos(viewAngle) * 14); camera.lookAt(0, 0, 0);
  // Keep lighting and shadows consistent in each viewer's frame of reference.
  light.position.set(-5 * Math.cos(viewAngle) + 6 * Math.sin(viewAngle), 14, 5 * Math.sin(viewAngle) + 6 * Math.cos(viewAngle));
  if (state) for (const chip of state.chips) {
    const mesh = chipMeshes.get(chip.id); if (!mesh) continue;
    const local = dragging?.id === chip.id ? dragging.point : null;
    const motion = layoutTween?.chips.get(chip.id);
    if (motion && !local && !chip.holder) {
      const angle = motion.angle * layoutProgress;
      const endX = motion.x * Math.cos(motion.angle) + motion.z * Math.sin(motion.angle);
      const endZ = motion.z * Math.cos(motion.angle) - motion.x * Math.sin(motion.angle);
      mesh.position.x = motion.x * Math.cos(angle) + motion.z * Math.sin(angle) + (chip.x - endX) * layoutProgress;
      mesh.position.z = motion.z * Math.cos(angle) - motion.x * Math.sin(angle) + (chip.z - endZ) * layoutProgress;
    } else {
      mesh.position.x += ((local?.x ?? chip.x) - mesh.position.x) * (local ? 1 : blend);
      mesh.position.z += ((local?.z ?? chip.z) - mesh.position.z) * (local ? 1 : blend);
    }
    mesh.position.y += ((chip.holder || local ? .48 : .12) - mesh.position.y) * blend;
  }
  for (const object of staticGroup.children) {
    if (object.userData.playerId && state) {
      const player = state.players.find(p => p.id === object.userData.playerId);
      if (player) object.rotation.y = (seatAngles.get(player.id) ?? 0) - player.seat * Math.PI * 2 / state.players.length;
    }
    if (object.userData.boardOffset !== undefined) {
      const offset = object.userData.boardOffset;
      object.position.set(Math.cos(viewAngle) * offset, -.045, -Math.sin(viewAngle) * offset);
      // Align the flat card's top edge away from the viewing player.
      object.rotation.set(-Math.PI / 2, 0, viewAngle);
    }
  }
  if (layoutProgress === 1) layoutTween = null;
  for (const object of staticGroup.children.flatMap(group => group.userData.playerId ? group.children : [group])) {
    const destination = object.userData.destination as THREE.Vector3 | undefined;
    if (destination) { object.position.lerp(destination, blend * .55); object.scale.lerp(new THREE.Vector3(.65, .65, .65), blend * .55); }
  }
  // Numbers sit on the chip face, but stay readable from the viewing seat.
  for (const group of [chipGroup, staticGroup]) group.traverse(object => {
    if (object.userData.chipNumber) object.rotation.set(-Math.PI / 2, 0, viewAngle);
  });
  renderer.render(scene, camera); requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
if (displayName && token) connect(); else { online(false, 'Welcome'); joinDialog.showModal(); }
