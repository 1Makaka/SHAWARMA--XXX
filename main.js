/* ============================================================================
 *  ШАУРМА ОТ КАРАМАТУЛЛО — main.js
 *  Three.js scene, rain, lights, GLB loading, PointerLockControls, raycast.
 *
 *  Flow:
 *    1) Грузим сцену → запускаем кинематографичный режим (камера медленно
 *       панорамирует по двору, идёт дождь, мигают неоны ларька).
 *    2) Игрок жмёт #start-btn → меню скрывается, включается PointerLock,
 *       камера лерпится к глазам игрока (FPS).
 *    3) WASD → ходим по двору с простой коллизией (clamp по box-границам).
 *    4) Прицел в центре кадра. Если смотрим на Караматулло, на дистанции
 *       < 4 единиц жмём E → console.log('Начат диалог'), exitPointerLock,
 *       показываем #dialog-box.
 *
 *  Зависимости (через importmap в index.html):
 *      three, three/addons/loaders/GLTFLoader.js,
 *      three/addons/controls/PointerLockControls.js,
 *      three/addons/lights/RectAreaLightUniformsLib.js
 * ========================================================================== */

import * as THREE from 'three';
import { GLTFLoader }              from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls }     from 'three/addons/controls/PointerLockControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

import { DIALOGS, ANGER } from './dialogs.js';

/* ============================================================================
 *  КОНСТАНТЫ
 * ========================================================================== */
const ASSETS = {
    HOUSE:      './House.glb',
    KARAMATULO: './KaramatuloIdle.glb',
};

const PLAYER = {
    EYE_HEIGHT:   1.7,          // высота камеры от пола
    SPEED:        4.2,          // м/сек на WASD
    SPRINT_MULT:  1.55,         // Shift
    BOUNDS:       18,           // half-extent квадрата двора (коллизия)
    INTERACT_DIST: 4.0,         // на каком расстоянии срабатывает «E»
};

const CINEMATIC = {
    RADIUS: 14,                 // радиус панорамирования камеры
    HEIGHT: 4.5,                // высота кам. в кинематографичном режиме
    SPEED:  0.07,               // угловая скорость
    LOOK_AT: new THREE.Vector3(0, 1.6, 0),  // цель — ларёк
};

/* ============================================================================
 *  CORE: renderer / scene / camera / clock
 * ========================================================================== */
const canvas   = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace      = THREE.SRGBColorSpace;
renderer.toneMapping           = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure   = 0.95;
renderer.shadowMap.enabled     = true;
renderer.shadowMap.type        = THREE.PCFSoftShadowMap;

// Инициализация RectAreaLight — обязательно ДО создания таких ламп
RectAreaLightUniformsLib.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
// Густой экспоненциальный туман — съедает дальний план, добавляет жути
scene.fog = new THREE.FogExp2(0x05060a, 0.045);

const camera = new THREE.PerspectiveCamera(
    62,                                          // FOV
    window.innerWidth / window.innerHeight,
    0.05,
    300
);
// Стартовое кинематографичное положение (вычислится в animate)
camera.position.set(CINEMATIC.RADIUS, CINEMATIC.HEIGHT, 0);

const clock = new THREE.Clock();

/* ============================================================================
 *  СВЕТ — общая засветка
 * ========================================================================== */
// Холодный амбиент — «лунный» свет, чтобы не было полной черноты
const ambient = new THREE.AmbientLight(0x223344, 0.35);
scene.add(ambient);

// Слабая направленная луна сверху-сзади (даёт мягкие тени от домов)
const moon = new THREE.DirectionalLight(0x99aacc, 0.45);
moon.position.set(-30, 40, -20);
moon.castShadow            = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left    = -40;
moon.shadow.camera.right   =  40;
moon.shadow.camera.top     =  40;
moon.shadow.camera.bottom  = -40;
moon.shadow.camera.near    =  0.5;
moon.shadow.camera.far     =  120;
moon.shadow.bias           = -0.0005;
scene.add(moon);
scene.add(moon.target);

/* ============================================================================
 *  МОКРЫЙ АСФАЛЬТ
 *  Тёмный, чуть бликующий plane. Имитация мокроты — низкий roughness +
 *  высокий metalness даёт «лужи» на дешёвом материале без env-map.
 * ========================================================================== */
const groundMat = new THREE.MeshStandardMaterial({
    color:     0x121214,
    roughness: 0.42,
    metalness: 0.55,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), groundMat);
ground.rotation.x  = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Несколько тёмных «луж» — слегка приподнятые плоскости, ещё более «мокрые»
function addPuddle(x, z, r) {
    const m = new THREE.Mesh(
        new THREE.CircleGeometry(r, 24),
        new THREE.MeshStandardMaterial({
            color: 0x0a0a0c, roughness: 0.08, metalness: 0.9,
        })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.01, z);
    m.receiveShadow = true;
    scene.add(m);
}
addPuddle( 3.2, 4.1, 1.2);
addPuddle(-4.8, 2.3, 1.6);
addPuddle( 5.9,-6.0, 0.9);
addPuddle(-2.1,-5.4, 1.4);

/* ============================================================================
 *  ЛАРЁК ШАУРМЫ (из примитивов)
 * ========================================================================== */
const kiosk = new THREE.Group();
kiosk.name = 'Kiosk';
scene.add(kiosk);

// — корпус ларька (грязный белый сайдинг)
const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xb6b1a3, roughness: 0.85, metalness: 0.05,
});
const body = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 2.4), bodyMat);
body.position.y      = 1.3;
body.castShadow      = true;
body.receiveShadow   = true;
kiosk.add(body);

// — крыша из жести (немного металлическая)
const roof = new THREE.Mesh(
    new THREE.BoxGeometry(4.4, 0.15, 2.8),
    new THREE.MeshStandardMaterial({ color: 0x303033, roughness: 0.4, metalness: 0.7 }),
);
roof.position.y = 2.7;
roof.castShadow = true;
kiosk.add(roof);

// — окно-прилавок (тёмная рама)
const frame = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 1.0, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8, metalness: 0.1 }),
);
frame.position.set(0, 1.55, 1.21);
frame.castShadow = true;
kiosk.add(frame);

// — стекло окна (полупрозрачный, чуть тёплый)
const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(2.0, 0.85),
    new THREE.MeshStandardMaterial({
        color: 0xfff0c8, emissive: 0xffaa55, emissiveIntensity: 0.6,
        roughness: 0.25, metalness: 0, transparent: true, opacity: 0.55,
    }),
);
glass.position.set(0, 1.55, 1.275);
kiosk.add(glass);

// — прилавок
const counter = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.15, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.55, metalness: 0.4 }),
);
counter.position.set(0, 1.05, 1.4);
counter.castShadow    = true;
counter.receiveShadow = true;
kiosk.add(counter);

// — НЕОНОВАЯ ВЫВЕСКА (плоскость с эмиссией)
const signGeo = new THREE.BoxGeometry(3.5, 0.55, 0.06);
const signMat = new THREE.MeshStandardMaterial({
    color: 0x110000,
    emissive: 0xff0820,
    emissiveIntensity: 2.4,
    roughness: 0.35,
});
const sign = new THREE.Mesh(signGeo, signMat);
sign.position.set(0, 2.45, 1.25);
kiosk.add(sign);

// — PointLight под вывеской (красный неон заливает асфальт)
const neon = new THREE.PointLight(0xff0820, 4.5, 14, 1.8);
neon.position.set(0, 2.3, 2.0);
neon.castShadow            = true;
neon.shadow.mapSize.set(512, 512);
neon.shadow.bias           = -0.001;
kiosk.add(neon);

// — RectAreaLight ИЗ окна ларька (тёплый «домашний» свет внутри)
const windowLight = new THREE.RectAreaLight(0xffb070, 6, 2.0, 0.85);
windowLight.position.set(0, 1.55, 1.30);
windowLight.lookAt(0, 1.55, 5);            // светит от ларька к игроку
kiosk.add(windowLight);

// — Уличный фонарь сбоку (жёлтый, мигающий)
const lampPost = new THREE.Group();
const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.5 })
);
post.position.y = 2;
post.castShadow = true;
lampPost.add(post);
const lampHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 12, 12),
    new THREE.MeshStandardMaterial({
        color: 0xfff1b0, emissive: 0xffd070, emissiveIntensity: 1.8,
    })
);
lampHead.position.set(0, 4.0, 0);
lampPost.add(lampHead);
const lampLight = new THREE.PointLight(0xffc060, 3.0, 18, 1.6);
lampLight.position.set(0, 4.0, 0);
lampLight.castShadow = true;
lampLight.shadow.mapSize.set(512, 512);
lampPost.add(lampLight);
lampPost.position.set(-6.5, 0, 3.5);
scene.add(lampPost);

/* ============================================================================
 *  ДОЖДЬ (THREE.Points)
 *  Капли — короткие вертикальные «штрихи»; рециклим, когда падают ниже пола.
 * ========================================================================== */
const RAIN_COUNT  = 4000;
const RAIN_BOX    = { x: 60, y: 30, z: 60 };

const rainGeo  = new THREE.BufferGeometry();
const rainPos  = new Float32Array(RAIN_COUNT * 3);
const rainVel  = new Float32Array(RAIN_COUNT);          // y-speed per particle

for (let i = 0; i < RAIN_COUNT; i++) {
    rainPos[i * 3 + 0] = (Math.random() - 0.5) * RAIN_BOX.x;
    rainPos[i * 3 + 1] =  Math.random()        * RAIN_BOX.y;
    rainPos[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX.z;
    rainVel[i]         = 14 + Math.random() * 10;
}
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));

const rainMat = new THREE.PointsMaterial({
    color:        0x8aa0c8,
    size:         0.06,
    transparent:  true,
    opacity:      0.55,
    depthWrite:   false,
    sizeAttenuation: true,
    fog:          true,
});
const rain = new THREE.Points(rainGeo, rainMat);
rain.frustumCulled = false;
scene.add(rain);

/* ============================================================================
 *  ЗАГРУЗКА GLB-моделей: House.glb (по кругу) + KaramatuloIdle.glb (в ларьке)
 * ========================================================================== */
const loader = new GLTFLoader();

let karamatulo       = null;                  // THREE.Object3D
let karamatuloMixer  = null;                  // THREE.AnimationMixer

/** Включает тени для всех мешей в дереве */
function enableShadows(root) {
    root.traverse((o) => {
        if (o.isMesh) {
            o.castShadow    = true;
            o.receiveShadow = true;
            // Параноидально приводим материал к чему-то предсказуемому
            if (o.material && 'envMapIntensity' in o.material) {
                o.material.envMapIntensity = 0.6;
            }
        }
    });
}

/** Загрузка House.glb и расстановка нескольких копий по кругу вокруг ларька */
function spawnHouses(gltfScene) {
    const COUNT  = 6;
    const RADIUS = 22;

    // Нормализуем размер: подгоним bounding box к ~12м высоты, чтобы советская
    // «многоэтажка» выглядела как многоэтажка независимо от того, в каких
    // единицах была экспортирована модель.
    const box     = new THREE.Box3().setFromObject(gltfScene);
    const size    = box.getSize(new THREE.Vector3());
    const scale   = 12 / Math.max(size.y, 0.001);

    for (let i = 0; i < COUNT; i++) {
        const a = (i / COUNT) * Math.PI * 2 + Math.PI / COUNT;
        const x = Math.cos(a) * RADIUS;
        const z = Math.sin(a) * RADIUS;

        const house = gltfScene.clone(true);
        house.scale.setScalar(scale * (0.9 + Math.random() * 0.25));
        house.position.set(x, 0, z);
        house.rotation.y = -a + Math.PI;               // лицом к центру двора
        enableShadows(house);
        scene.add(house);
    }
}

loader.load(
    ASSETS.HOUSE,
    (gltf) => spawnHouses(gltf.scene),
    undefined,
    (err) => console.error('[ШАУРМА] House.glb не загрузился:', err)
);

loader.load(
    ASSETS.KARAMATULO,
    (gltf) => {
        karamatulo = gltf.scene;

        // Подгоним рост ~1.75м
        const box   = new THREE.Box3().setFromObject(karamatulo);
        const size  = box.getSize(new THREE.Vector3());
        const scale = 1.75 / Math.max(size.y, 0.001);
        karamatulo.scale.setScalar(scale);

        // Ставим внутри ларька, лицом к окну (к игроку, который стоит на +Z)
        karamatulo.position.set(0, 0, 0.2);
        karamatulo.rotation.y = 0;
        karamatulo.name = 'Karamatulo';

        enableShadows(karamatulo);
        scene.add(karamatulo);

        // Анимация Idle (запекли в GLB)
        if (gltf.animations && gltf.animations.length) {
            karamatuloMixer = new THREE.AnimationMixer(karamatulo);
            // Берём первый клип — если их несколько, ищем по имени
            const idleClip =
                gltf.animations.find((c) => /idle/i.test(c.name)) || gltf.animations[0];
            const action = karamatuloMixer.clipAction(idleClip);
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.play();
        } else {
            console.warn('[ШАУРМА] У KaramatuloIdle.glb нет анимаций.');
        }
    },
    undefined,
    (err) => console.error('[ШАУРМА] KaramatuloIdle.glb не загрузился:', err)
);

/* ============================================================================
 *  ИГРОК / УПРАВЛЕНИЕ
 * ========================================================================== */
const player = {
    mode:        'cinematic',   // 'cinematic' | 'fps' | 'dialog'
    velocity:    new THREE.Vector3(),
    keys:        Object.create(null),
};

const controls = new PointerLockControls(camera, document.body);
scene.add(controls.getObject());

// Точка спавна игрока (FPS-камера), стоя перед окном ларька
const SPAWN = new THREE.Vector3(0, PLAYER.EYE_HEIGHT, 4.5);

/* ----- Клавиатура ----- */
window.addEventListener('keydown', (e) => {
    player.keys[e.code] = true;

    // E — попытка взаимодействия с Караматулло
    if (e.code === 'KeyE' && player.mode === 'fps') tryInteract();

    // Esc автоматически снимает PointerLock — обработаем в lock-listener
});
window.addEventListener('keyup',   (e) => { player.keys[e.code] = false; });

controls.addEventListener('unlock', () => {
    // Сняли pointer-lock: если мы не в диалоге, выходим в кинематик
    if (player.mode === 'fps') player.mode = 'fps-paused';
});

/* ============================================================================
 *  HUD / DOM
 * ========================================================================== */
const dom = {
    menu:      document.getElementById('main-menu'),
    hud:       document.getElementById('hud'),
    dialog:    document.getElementById('dialog-box'),
    anger:     document.getElementById('anger-meter'),
    startBtn:  document.getElementById('start-btn'),
    settings:  document.getElementById('btn-settings'),
    exit:      document.getElementById('btn-exit'),
    dayValue:  document.getElementById('day-value'),
    angerFill: document.getElementById('anger-fill'),
    speaker:   document.getElementById('speaker-name'),
    line:      document.getElementById('dialog-line'),
    choices:   document.getElementById('dialog-choices'),
};

/* ----- Главное меню → переход в FPS ----- */
dom.startBtn.addEventListener('click', enterGameplay);

dom.exit.addEventListener('click', () => {
    document.body.classList.add('is-rewinding');
});

dom.settings.addEventListener('click', () => {
    console.log('[ШАУРМА] Settings — TODO');
});

/* Плавный лерп камеры из кинематика → в SPAWN, затем включаем PointerLock */
function enterGameplay() {
    if (player.mode !== 'cinematic') return;
    player.mode = 'transition';

    // Скрываем меню (через CSS-transition is-leaving), потом выставляем display:none
    dom.menu.classList.add('is-leaving');
    dom.menu.addEventListener('transitionend', () => {
        dom.menu.style.display = 'none';
        dom.hud.hidden    = false;
        dom.anger.hidden  = false;
    }, { once: true });

    // Лерпим камеру в позицию игрока за ~1.2 сек
    const from   = camera.position.clone();
    const fromQ  = camera.quaternion.clone();

    const tmpCam = new THREE.PerspectiveCamera();
    tmpCam.position.copy(SPAWN);
    tmpCam.lookAt(0, 1.6, 0);                  // смотрим на ларёк
    const toQ = tmpCam.quaternion.clone();

    const DURATION = 1.2;
    let   t        = 0;

    function step(dt) {
        t = Math.min(1, t + dt / DURATION);
        // Easing — easeInOutCubic
        const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        camera.position.lerpVectors(from, SPAWN, k);
        camera.quaternion.copy(fromQ).slerp(toQ, k);

        if (t < 1) {
            // продолжим из главного цикла
            transitionStep = step;
        } else {
            transitionStep = null;
            player.mode = 'fps';
            controls.lock();
        }
    }
    transitionStep = step;
}
let transitionStep = null;

/* ============================================================================
 *  RAYCAST: взаимодействие «E»
 * ========================================================================== */
const raycaster = new THREE.Raycaster();
const FORWARD   = new THREE.Vector3();
raycaster.far   = PLAYER.INTERACT_DIST;

function lookingAtKaramatulo() {
    if (!karamatulo) return false;

    camera.getWorldDirection(FORWARD);
    raycaster.set(camera.position, FORWARD);

    const hits = raycaster.intersectObject(karamatulo, true);
    if (!hits.length) return false;

    return hits[0].distance < PLAYER.INTERACT_DIST;
}

function tryInteract() {
    if (!lookingAtKaramatulo()) return;

    console.log('Начат диалог');

    player.mode = 'dialog';
    document.exitPointerLock();

    dom.dialog.hidden = false;
    renderDialogNode(currentDay, 0);             // показать первую реплику
}

/* ============================================================================
 *  ДИАЛОГИ — минимальный движок: печатает строку, рендерит 3 кнопки.
 * ========================================================================== */
let currentDay = 1;
let angerValue = 0;

function setAnger(v) {
    angerValue = Math.max(0, Math.min(ANGER.MAX, v));
    dom.angerFill.style.height = `${(angerValue / ANGER.MAX) * 100}%`;
    dom.anger.classList.toggle('is-critical', angerValue >= ANGER.BREAKPOINT);
}

function renderDialogNode(day, idx) {
    const list = DIALOGS[`day${day}`];
    if (!list) return;
    const node = list[idx];
    if (!node) return;

    dom.speaker.textContent = 'КАРАМАТУЛЛО';
    dom.line.textContent    = node.line;
    dom.choices.innerHTML   = '';

    if (node.endOfDay) {
        // Конец дня — кнопка «Дальше». Триггер скримера на дне 4.
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.tone = 'normal';
        btn.textContent = node.triggersJumpscare ? 'РАЗВЕРНУТЬСЯ И УЙТИ' : 'УЙТИ ДОМОЙ';
        btn.addEventListener('click', () => {
            if (node.triggersJumpscare) {
                triggerJumpscare();
            } else {
                endOfDay();
            }
        });
        li.appendChild(btn);
        dom.choices.appendChild(li);
        return;
    }

    node.choices.forEach((ch) => {
        const li  = document.createElement('li');
        const btn = document.createElement('button');
        btn.type            = 'button';
        btn.dataset.tone    = ch.tone;
        btn.dataset.anger   = ch.anger;
        btn.textContent     = ch.text;
        btn.addEventListener('click', () => {
            setAnger(angerValue + ch.anger);
            if (node.next != null) renderDialogNode(day, node.next);
        });
        li.appendChild(btn);
        dom.choices.appendChild(li);
    });
}

function endOfDay() {
    dom.dialog.hidden = true;
    currentDay = Math.min(4, currentDay + 1);
    dom.dayValue.textContent = `${currentDay} / 4`;
    setAnger(0);
    // Возвращаем управление
    player.mode = 'fps';
    controls.lock();
}

function triggerJumpscare() {
    const js = document.getElementById('jumpscare');
    js.classList.add('is-active');
    setTimeout(() => {
        js.classList.remove('is-active');
        // TODO: переход в «Подвал»
        console.log('[ШАУРМА] → Подвал');
    }, 1200);
}

/* ============================================================================
 *  ГЛАВНЫЙ ЦИКЛ
 * ========================================================================== */
function updateCinematic(t) {
    const a = t * CINEMATIC.SPEED;
    camera.position.set(
        Math.cos(a) * CINEMATIC.RADIUS,
        CINEMATIC.HEIGHT + Math.sin(a * 0.6) * 0.4,
        Math.sin(a) * CINEMATIC.RADIUS
    );
    camera.lookAt(CINEMATIC.LOOK_AT);
}

function updateFPS(dt) {
    if (!controls.isLocked) return;

    // Скорость по WASD
    const speed = (player.keys['ShiftLeft'] || player.keys['ShiftRight'])
        ? PLAYER.SPEED * PLAYER.SPRINT_MULT
        : PLAYER.SPEED;

    const forward = (player.keys['KeyW'] ? 1 : 0) - (player.keys['KeyS'] ? 1 : 0);
    const strafe  = (player.keys['KeyD'] ? 1 : 0) - (player.keys['KeyA'] ? 1 : 0);

    // PointerLockControls имеет moveForward/moveRight, который двигает вдоль
    // плоскости XZ относительно текущего направления взгляда.
    if (forward) controls.moveForward(forward * speed * dt);
    if (strafe)  controls.moveRight  (strafe  * speed * dt);

    // ---- Простейшая коллизия: ограничиваем XZ квадратом двора ----
    const obj = controls.getObject();
    obj.position.x = THREE.MathUtils.clamp(obj.position.x, -PLAYER.BOUNDS, PLAYER.BOUNDS);
    obj.position.z = THREE.MathUtils.clamp(obj.position.z, -PLAYER.BOUNDS, PLAYER.BOUNDS);

    // ---- «Коллизия» с ларьком: не позволяем зайти внутрь короба ----
    const kx = obj.position.x, kz = obj.position.z;
    if (kz < 1.25 + 0.4 && kz > -1.25 - 0.4 && Math.abs(kx) < 2.0 + 0.4) {
        // Игрок упёрся в стенку ларька — отодвигаем по Z к ближайшей грани
        obj.position.z = kz > 0 ? 1.65 : -1.65;
    }

    // ---- Пол ----
    obj.position.y = PLAYER.EYE_HEIGHT;
}

function updateRain(dt) {
    const pos = rainGeo.attributes.position.array;
    for (let i = 0; i < RAIN_COUNT; i++) {
        const iy = i * 3 + 1;
        pos[iy] -= rainVel[i] * dt;
        if (pos[iy] < 0) {
            pos[i * 3 + 0] = (Math.random() - 0.5) * RAIN_BOX.x + camera.position.x;
            pos[iy]        =  RAIN_BOX.y;
            pos[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX.z + camera.position.z;
        }
    }
    rainGeo.attributes.position.needsUpdate = true;
}

function flickerLights(t) {
    // Неон — лёгкое мерцание
    neon.intensity      = 4.5 + Math.sin(t * 17) * 0.4 + (Math.random() < 0.02 ? -2 : 0);
    // Фонарь — иногда «моргает»
    lampLight.intensity = 3.0 + Math.sin(t * 4)  * 0.25 + (Math.random() < 0.01 ? -2.5 : 0);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

function animate() {
    requestAnimationFrame(animate);

    const dt = Math.min(clock.getDelta(), 0.05);   // защита от лагов
    const t  = clock.elapsedTime;

    // 1) Камера
    if (player.mode === 'cinematic')     updateCinematic(t);
    else if (transitionStep)             transitionStep(dt);
    else if (player.mode === 'fps')      updateFPS(dt);

    // 2) Сцена
    updateRain(dt);
    flickerLights(t);

    // 3) Анимация Караматулло
    if (karamatuloMixer) karamatuloMixer.update(dt);

    renderer.render(scene, camera);
}

animate();

/* ============================================================================
 *  Экспорт для отладки из консоли
 * ========================================================================== */
window.GAME = { scene, camera, renderer, player, controls, DIALOGS, ANGER };
