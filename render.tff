const puppeteer = require("puppeteer");
const { spawn } = require("child_process");
const path = require("path");

const FPS = 30;
const MAX_DURATION = 15;

const WIDTH = 1080;
const HEIGHT = 1920;

const INPUT = path.resolve(
  process.env.INPUT || "source.html"
);

const OUTPUT = path.resolve(
  process.env.OUTPUT || "output.mp4"
);

async function main() {
  console.log("Starting browser...");

  const browser = await puppeteer.launch({
    headless: true,

    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding"
    ]
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1
    });

    console.log("Loading:", INPUT);

    await page.goto(`file://${INPUT}`, {
      waitUntil: "networkidle0"
    });

    await page.evaluate(async () => {
      if (document.fonts) {
        await document.fonts.ready;
      }
    });

    /*
     * Tell the HTML that it is being rendered.
     */
    await page.evaluate(() => {
      document.documentElement.dataset.rendering = "true";
    });

    /*
     * Find the animation duration.
     */
    const detectedDuration = await page.evaluate(() => {
      const values = [];

      if (
        typeof window.RENDER_DURATION === "number"
      ) {
        values.push(window.RENDER_DURATION);
      }

      if (
        typeof window.DURATION === "number"
      ) {
        values.push(window.DURATION);
      }

      const htmlDuration =
        document.documentElement.dataset.duration;

      if (htmlDuration) {
        values.push(Number(htmlDuration));
      }

      const meta =
        document.querySelector(
          'meta[name="video-duration"]'
        );

      if (meta) {
        values.push(Number(meta.content));
      }

      const valid = values.filter(
        value =>
          Number.isFinite(value) &&
          value > 0
      );

      return valid.length
        ? valid[0]
        : null;
    });

    let duration =
      detectedDuration || MAX_DURATION;

    duration = Math.min(
      duration,
      MAX_DURATION
    );

    duration = Math.max(
      duration,
      1 / FPS
    );

    const totalFrames =
      Math.ceil(duration * FPS);

    console.log(
      `Animation duration: ${duration.toFixed(3)}s`
    );

    console.log(
      `Rendering ${totalFrames} frames at ${FPS} FPS`
    );

    /*
     * Start FFmpeg.
     */
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-y",
        
        "-f",
        "image2pipe",
        
        "-vcodec",
        "png",
        
        "-r",
        String(FPS), // <--- This forces the output FPS
        
        "-i",
        "-",
        
        "-an",
        
        "-c:v",
        "libx264",
        
        "-preset",
        "veryfast",
        
        "-crf",
        "18",
        
        "-pix_fmt",
        "yuv420p",
        
        "-movflags",
        "+faststart",

        OUTPUT
      ],
      {
        stdio: [
          "pipe",
          "inherit",
          "inherit"
        ]
      }
    );

    /*
     * Render frames.
     * Try calling seekToFrame only ONCE at the start to avoid speed glitches.
     */
    for (
      let frame = 0;
      frame < totalFrames;
      frame++
    ) {

      const time = frame / FPS;

      /*
       * Initialize the scene on the first frame.
       * Do not call this inside the loop, otherwise you trigger 
       * double-speed physics calculations.
       */
      if (frame === 0) {
        await page.evaluate(async (time, fps) => {
            if (typeof window.seekToFrame === "function") {
              await window.seekToFrame(0, time, fps);
            } else {
              window.__renderTime = time;
            }
        }, time, FPS);
        
        // We pause the loop here briefly to ensure render is stable
        await new Promise(r => setTimeout(r, 10));
      }

      // Fetch the current state from the browser
      // (We only need to grab the data, not calculate new animation frames here)
      const renderState = await page.evaluate(() => {
        // If your HTML updates __renderTime on loop start, fetch it.
        // Otherwise, this returns 0 (start time).
        return window.__renderTime || 0;
      });

      /*
       * Allow browser rendering to settle.
       */
      await page.evaluate(
        () =>
          new Promise(resolve => {
            requestAnimationFrame(() => {
              requestAnimationFrame(resolve);
            });
          })
      );

      /*
       * Capture frame.
       */
      const image =
        await page.screenshot({
          type: "png"
        });

      /*
       * Prevent FFmpeg pipe from
       * growing indefinitely.
       */
      if (
        !ffmpeg.stdin.write(image)
      ) {

        await new Promise(resolve =>
          ffmpeg.stdin.once(
            "drain",
            resolve
          )
        );

      }

      if (
        frame % FPS === 0 ||
        frame === totalFrames - 1
      ) {

        console.log(
          `Frame ${frame + 1}/${totalFrames} ` +
          `(${(frame + 1) / FPS.toFixed(1)}s)`
        );

      }
    }

    ffmpeg.stdin.end();

    /*
     * Wait for FFmpeg.
     */
    await new Promise(
      (resolve, reject) => {

        ffmpeg.once(
          "close",
          code => {

            if (code === 0) {
              resolve();
            } else {
              reject(
                new Error(
                  `FFmpeg exited with code ${code}`
                )
              );
            }

          }
        );

        ffmpeg.once(
          "error",
          reject
        );

      }
    );

    console.log(
      "====================================="
    );
    console.log(
      "MP4 created successfully!"
    );
    console.log(
      OUTPUT
    );
    console.log(
      "====================================="
    );

  } finally {

    await browser.close();

  }
}

main().catch(error => {

  console.error(error);

  process.exit(1);

});
