/**
 * Scroll-Driven Video Playback — Canvas Frame Cache Approach
 * ===========================================================
 * 
 * WHY CANVAS + FRAME CACHING?
 * Setting video.currentTime on every scroll event causes jitter because:
 * 1. The browser must seek to the nearest keyframe and decode forward
 * 2. The video element doesn't repaint until decoding completes
 * 3. This creates visible "jumps" between frames
 * 
 * SOLUTION (Apple's actual approach):
 * 1. Step through the video frame-by-frame during loading
 * 2. Capture each frame as an ImageBitmap (GPU-accelerated)
 * 3. On scroll, instantly draw the correct cached frame to a canvas
 * 4. Result: perfectly smooth, zero-lag playback
 * 
 * MEMORY: ~6s video at 30fps = ~180 frames. Each frame at 1920x1080 
 * takes ~8MB uncompressed, but ImageBitmap uses GPU memory efficiently.
 * Total: ~200-400MB GPU memory — acceptable for modern devices.
 */

(function () {
    'use strict';

    // ============================================================
    // Configuration
    // ============================================================
    const FRAME_RATE = 30;           // Frames per second to extract
    const MAX_FRAMES = 300;          // Safety cap on frames
    const SCROLL_HEIGHT_VH = 500;    // How many viewport heights of scroll

    // ============================================================
    // Elements
    // ============================================================
    const preloader = document.getElementById('preloader');
    const preloaderPercent = document.getElementById('preloader-percent');
    const canvas = document.getElementById('scroll-canvas');
    const ctx = canvas.getContext('2d');
    const videoSection = document.getElementById('video-section');
    const progressBar = document.getElementById('progress-bar');
    const frameInfo = document.getElementById('frame-info');


    // ============================================================
    // State
    // ============================================================
    let frames = [];                 // Array of ImageBitmap objects
    let totalFrames = 0;
    let currentFrameIndex = -1;
    let isReady = false;
    let canvasWidth = 0;
    let canvasHeight = 0;
    let videoDuration = 0;

    // ============================================================
    // Frame Extraction — the core technique
    // ============================================================
    async function extractFrames() {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.preload = 'auto';
            video.crossOrigin = 'anonymous';
            video.src = 'materials/S7 Mesh A2.mp4';

            video.addEventListener('error', (e) => {
                console.error('[ScrollVideo] Video load error:', e);
                reject(e);
            });

            video.addEventListener('loadedmetadata', () => {
                videoDuration = video.duration;
                totalFrames = Math.min(
                    Math.ceil(videoDuration * FRAME_RATE),
                    MAX_FRAMES
                );

                // Set canvas size to match video
                canvasWidth = video.videoWidth;
                canvasHeight = video.videoHeight;
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;

                console.log(`[ScrollVideo] Extracting ${totalFrames} frames from ${videoDuration.toFixed(2)}s video (${canvasWidth}×${canvasHeight})`);

                // Start extracting frames one by one
                extractNextFrame(video, 0, resolve);
            });

            // Trigger load
            video.load();
        });
    }

    function extractNextFrame(video, frameIndex, resolve) {
        if (frameIndex >= totalFrames) {
            // Done!
            console.log(`[ScrollVideo] Extraction complete: ${frames.length} frames cached`);
            resolve();
            return;
        }

        const time = (frameIndex / totalFrames) * videoDuration;

        video.onseeked = async () => {
            try {
                // Draw current frame to canvas temporarily to create bitmap
                ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);

                // Create an ImageBitmap for fast future rendering
                const bitmap = await createImageBitmap(canvas);
                frames.push(bitmap);

                // Update preloader
                const percent = Math.round(((frameIndex + 1) / totalFrames) * 100);
                preloaderPercent.textContent = percent + '%';

                // Continue with next frame
                extractNextFrame(video, frameIndex + 1, resolve);
            } catch (err) {
                console.warn(`[ScrollVideo] Frame ${frameIndex} capture failed, skipping:`, err);
                // Still continue
                extractNextFrame(video, frameIndex + 1, resolve);
            }
        };

        video.currentTime = time;
    }

    // ============================================================
    // Initialize
    // ============================================================
    async function init() {
        try {
            await extractFrames();

            isReady = true;
            totalFrames = frames.length;

            // Draw first frame
            drawFrame(0);

            // Hide preloader
            setTimeout(() => {
                preloader.classList.add('hidden');
            }, 200);

            // Start scroll handling
            setupScrollHandler();

            console.log(`[ScrollVideo] Ready! ${totalFrames} frames cached. Scroll to play.`);
        } catch (err) {
            console.error('[ScrollVideo] Init failed:', err);
            preloaderPercent.textContent = 'Error';
        }
    }

    // ============================================================
    // Draw a frame — ultra fast, just blits a cached bitmap
    // ============================================================
    function drawFrame(index) {
        const clampedIndex = Math.max(0, Math.min(index, totalFrames - 1));

        if (clampedIndex === currentFrameIndex) return; // No change needed

        const bitmap = frames[clampedIndex];
        if (!bitmap) return;

        ctx.drawImage(bitmap, 0, 0, canvasWidth, canvasHeight);
        currentFrameIndex = clampedIndex;
    }

    // ============================================================
    // Scroll Handler — requestAnimationFrame for 60fps
    // ============================================================
    let ticking = false;

    function setupScrollHandler() {
        window.addEventListener('scroll', onScroll, { passive: true });
        // Trigger initial
        onScroll();
    }

    function onScroll() {
        if (!ticking) {
            requestAnimationFrame(updateOnScroll);
            ticking = true;
        }
    }

    function updateOnScroll() {
        ticking = false;

        if (!isReady || totalFrames === 0) return;

        // Calculate scroll progress through the video section
        const rect = videoSection.getBoundingClientRect();
        const sectionHeight = videoSection.offsetHeight - window.innerHeight;
        const scrolled = -rect.top;
        const progress = Math.max(0, Math.min(1, scrolled / sectionHeight));

        // Map progress to frame index
        const frameIndex = Math.round(progress * (totalFrames - 1));

        // Draw the frame (instant — no decoding needed!)
        drawFrame(frameIndex);

        // Update UI
        updateProgressBar(progress);
        updateFrameInfo(frameIndex, progress);
    }

    // ============================================================
    // UI Updates
    // ============================================================
    function updateProgressBar(progress) {
        progressBar.style.width = (progress * 100) + '%';
    }

    function updateFrameInfo(frameIndex, progress) {
        const time = (frameIndex / totalFrames) * videoDuration;
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        const timeStr = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
        const progressStr = Math.round(progress * 100) + '%';

        const spans = frameInfo.querySelectorAll('span');
        spans[0].textContent = timeStr;
        spans[2].textContent = progressStr;
    }

    // ============================================================
    // Hero fade on scroll
    // ============================================================
    const heroContent = document.querySelector('.hero-content');

    function updateHeroFade() {
        const scrollY = window.scrollY;
        const heroHeight = window.innerHeight;
        const fadeProgress = Math.min(scrollY / (heroHeight * 0.5), 1);

        if (heroContent) {
            heroContent.style.opacity = 1 - fadeProgress;
            heroContent.style.transform = `translateY(${fadeProgress * -30}px)`;
        }
    }

    window.addEventListener('scroll', () => {
        requestAnimationFrame(updateHeroFade);
    }, { passive: true });

    // ============================================================
    // Intersection Observer for metrics section
    // ============================================================
    const metricsSection = document.getElementById('metrics');
    const metrics = document.querySelectorAll('.metric');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                metrics.forEach((metric, i) => {
                    setTimeout(() => {
                        metric.style.opacity = '1';
                        metric.style.transform = 'translateY(0)';
                    }, i * 150);
                });
                observer.disconnect();
            }
        });
    }, { threshold: 0.2 });

    metrics.forEach(metric => {
        metric.style.opacity = '0';
        metric.style.transform = 'translateY(20px)';
        metric.style.transition = 'opacity 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94), transform 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    });

    if (metricsSection) {
        observer.observe(metricsSection);
    }

    // ============================================================
    // Handle canvas resize for responsive display
    // ============================================================
    function handleResize() {
        // Canvas internal resolution stays the same (video resolution)
        // CSS handles the display scaling
        if (isReady && currentFrameIndex >= 0) {
            drawFrame(currentFrameIndex);
        }
    }

    window.addEventListener('resize', handleResize);

    // ============================================================
    // Start
    // ============================================================
    init();

})();
