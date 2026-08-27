// Local Easter egg for its dedicated extension window. It has no storage or network side effects.
document.addEventListener('DOMContentLoaded', () => {
    const requestedScale = new URLSearchParams(location.search).get('uiScale');
    if (['auto', '90', '100', '110', '125', '150'].includes(requestedScale)) {
        document.documentElement.dataset.uiScale = requestedScale;
    }
    const closeButton = document.getElementById('debugEasterEggClose');
    const clearButton = document.getElementById('debugEasterEggClear');
    const target = document.getElementById('debugEasterEggTarget');
    const portrait = document.getElementById('debugEasterEggPortrait');
    const fileInput = document.getElementById('debugEasterEggFile');
    const hint = document.getElementById('debugEasterEggHint');
    const header = document.querySelector('.debug-easter-egg-header');
    if (!closeButton || !clearButton || !target || !portrait || !fileInput || !hint || !header) return;
    portrait.draggable = false;

    const spriteSources = Array.from({ length: 9 }, (_, index) => `assets/ui/cache-${String(index + 1).padStart(2, '0')}.txt`);
    const assetUrls = new Map();
    let selectedFileUrl = null;
    let spritesReady = false;
    const randomBetween = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);
    const imageScale = () => Math.sqrt((target.clientWidth * target.clientHeight) / (640 * 640));
    const decodeAsset = async (source) => {
        if (assetUrls.has(source)) return assetUrls.get(source);
        const response = await fetch(chrome.runtime.getURL(source));
        if (!response.ok) throw new Error(`Unable to load local asset: ${source}`);
        const base64 = (await response.text()).replace(/\s+/g, '');
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
        assetUrls.set(source, url);
        return url;
    };
    const waitForImage = () => new Promise((resolve, reject) => {
        portrait.addEventListener('load', resolve, { once: true });
        portrait.addEventListener('error', reject, { once: true });
    });
    const resizeWindowForImage = async () => {
        const currentWindow = await chrome.windows.getCurrent();
        const windowFrameWidth = Math.max(0, currentWindow.width - window.innerWidth);
        const windowFrameHeight = Math.max(0, currentWindow.height - window.innerHeight);
        const contentPaddingWidth = 32;
        const headerHeight = Math.ceil(header.getBoundingClientRect().height) + 12;
        const contentPaddingHeight = headerHeight + 32;
        const maxWindowWidth = Math.max(320, screen.availWidth - 16);
        const maxWindowHeight = Math.max(320, screen.availHeight - 16);
        const maxImageWidth = Math.max(1, maxWindowWidth - windowFrameWidth - contentPaddingWidth);
        const maxImageHeight = Math.max(1, maxWindowHeight - windowFrameHeight - contentPaddingHeight);
        const scale = Math.min(1, maxImageWidth / portrait.naturalWidth, maxImageHeight / portrait.naturalHeight);
        portrait.style.width = `${Math.max(1, Math.floor(portrait.naturalWidth * scale))}px`;
        portrait.style.height = `${Math.max(1, Math.floor(portrait.naturalHeight * scale))}px`;
        await chrome.windows.update(currentWindow.id, {
            width: Math.min(maxWindowWidth, Math.ceil(portrait.clientWidth + contentPaddingWidth + windowFrameWidth)),
            height: Math.min(maxWindowHeight, Math.ceil(portrait.clientHeight + contentPaddingHeight + windowFrameHeight)),
        });
    };
    const showImage = async (url) => {
        const loaded = waitForImage();
        portrait.hidden = false;
        portrait.src = url;
        await loaded;
        hint.textContent = 'Нажимайте по фото.';
        await resizeWindowForImage();
    };
    const loadAssets = async () => {
        await Promise.all(spriteSources.map(decodeAsset));
        spritesReady = true;
    };
    const shuffleSprites = (sprites) => {
        const shuffled = [...sprites];
        for (let index = shuffled.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }
        return shuffled;
    };
    let spriteBag = [];
    let lastSprite = null;
    const randomSprite = () => {
        if (!spriteBag.length) {
            spriteBag = shuffleSprites(spriteSources);
            if (lastSprite && spriteBag[0] === lastSprite) {
                [spriteBag[0], spriteBag[1]] = [spriteBag[1], spriteBag[0]];
            }
        }
        const sprite = spriteBag.shift();
        lastSprite = sprite;
        return sprite;
    };
    const randomAngle = () => Math.floor(Math.random() * 360);
    let throwGeneration = 0;

    const resetSplats = () => {
        throwGeneration += 1;
        target.querySelectorAll('.debug-easter-egg-effect').forEach((effect) => effect.remove());
    };
    const createPoopSprite = (className, source = randomSprite(), size = randomBetween(36, 68)) => {
        const poop = document.createElement('img');
        const pixelSize = Math.max(10, Math.round(size * imageScale()));
        poop.className = className;
        poop.src = assetUrls.get(source);
        poop.alt = '';
        poop.draggable = false;
        poop.width = pixelSize;
        poop.height = pixelSize;
        poop.style.setProperty('--poop-size', `${pixelSize}px`);
        return poop;
    };
    const createImpactSplat = (x, y, source) => {
        const impact = document.createElement('div');
        impact.className = 'debug-easter-egg-impact debug-easter-egg-effect';
        impact.style.left = `${x}px`;
        impact.style.top = `${y}px`;
        const impactRotation = randomAngle();
        impact.style.setProperty('--splat-rotation', `${impactRotation}deg`);
        impact.appendChild(createPoopSprite('debug-easter-egg-splat', source, randomBetween(38, 72)));
        for (let index = 0; index < 4; index += 1) {
            const droplet = document.createElement('span');
            const angle = (Math.PI * 2 * index) / 4 + Math.random() * 0.55;
            const distance = 20 + Math.random() * 13;
            droplet.className = 'debug-easter-egg-droplet';
            droplet.style.setProperty('--drop-x', `${Math.cos(angle) * distance}px`);
            droplet.style.setProperty('--drop-y', `${Math.sin(angle) * distance}px`);
            droplet.style.setProperty('--drop-size', `${5 + Math.round(Math.random() * 4)}px`);
            impact.appendChild(droplet);
        }
        target.appendChild(impact);
    };
    const animateProjectile = (destinationX, destinationY) => {
        if (!spritesReady) return;
        const generation = throwGeneration;
        const source = randomSprite();
        const flightRotation = randomAngle();
        const projectile = createPoopSprite('debug-easter-egg-projectile debug-easter-egg-effect', source, randomBetween(32, 58));
        const startX = target.clientWidth * randomBetween(.15, .85);
        const startY = target.clientHeight + 28;
        const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 460;
        const startTime = performance.now();
        target.appendChild(projectile);
        const frame = (now) => {
            if (generation !== throwGeneration) return;
            const progress = duration ? Math.min(1, (now - startTime) / duration) : 1;
            const x = startX + (destinationX - startX) * progress;
            const arcHeight = Math.min(125, Math.max(70, Math.abs(destinationX - startX) * .35));
            const y = startY + (destinationY - startY) * progress - 4 * arcHeight * progress * (1 - progress);
            projectile.style.left = `${x}px`;
            projectile.style.top = `${y}px`;
            projectile.style.transform = `translate(-50%, -50%) rotate(${flightRotation + progress * 340}deg)`;
            if (progress < 1) return requestAnimationFrame(frame);
            projectile.remove();
            createImpactSplat(destinationX, destinationY, source);
        };
        requestAnimationFrame(frame);
    };

    closeButton.addEventListener('click', () => window.close());
    clearButton.addEventListener('click', resetSplats);
    target.addEventListener('dragstart', (event) => event.preventDefault());
    target.addEventListener('click', (event) => {
        const rect = target.getBoundingClientRect();
        animateProjectile(event.clientX - rect.left, event.clientY - rect.top);
    });
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file || !/\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(file.name)) return;
        const nextUrl = URL.createObjectURL(file);
        try {
            await showImage(nextUrl);
            if (selectedFileUrl) URL.revokeObjectURL(selectedFileUrl);
            selectedFileUrl = nextUrl;
            resetSplats();
        } catch {
            URL.revokeObjectURL(nextUrl);
        } finally {
            fileInput.value = '';
        }
    });
    window.addEventListener('unload', () => {
        assetUrls.forEach((url) => URL.revokeObjectURL(url));
        if (selectedFileUrl) URL.revokeObjectURL(selectedFileUrl);
    });
    loadAssets().catch(() => window.close());
});
