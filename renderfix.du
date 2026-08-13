const puppeteer = require("puppeteer");
const { spawn } = require("child_process");
const path = require("path");

const FPS = 30;
const DURATION = 6;

const WIDTH = 1080;
const HEIGHT = 1920;

const TOTAL_FRAMES = FPS * DURATION;

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

    const htmlPath = path.resolve("index.html");

    console.log("Loading:", htmlPath);

    await page.goto(
      `file://${htmlPath}`,
      {
        waitUntil: "networkidle0"
      }
    );

    console.log("Page loaded.");

    /*
     * Give fonts/images a moment to finish.
     */
    await page.evaluate(async () => {
      if (document.fonts) {
        await document.fonts.ready;
      }
    });

    /*
     * Tell the page rendering has started.
     */
    await page.evaluate(() => {
      document.documentElement.dataset.rendering = "true";
    });

    console.log(
      `Rendering ${TOTAL_FRAMES} frames...`
    );

    /*
     * FFmpeg receives PNG frames through stdin.
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
        String(FPS),

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
     * Make sure FFmpeg didn't immediately fail.
     */
    ffmpeg.on("error", (error) => {
      console.error(
        "FFmpeg error:",
        error
      );
    });

    /*
     * Render each frame deterministically.
     */
    for (
      let frame = 0;
      frame < TOTAL_FRAMES;
      frame++
    ) {
      const time = frame / FPS;

      await page.evaluate(
        (frame, time, fps) => {
          /*
           * If the HTML provides seekToFrame(),
           * use it.
           */
          if (
            typeof window.seekToFrame ===
            "function"
          ) {
            return window.seekToFrame(
              frame,
              time,
              fps
            );
          }

          /*
           * Otherwise expose the current
           * render time for simple HTML.
           */
          window.__renderTime = time;
        },
        frame,
        time,
        FPS
      );

      /*
       * Allow layout/paint to complete.
       */
      await page.evaluate(
        () =>
          new Promise(resolve =>
            requestAnimationFrame(() =>
              requestAnimationFrame(
                resolve
              )
            )
          )
      );

      const image =
        await page.screenshot({
          type: "png"
        });

      /*
       * Backpressure:
       * wait when FFmpeg's stdin buffer
       * is full.
       */
      if (!ffmpeg.stdin.write(image)) {
        await new Promise(resolve => {
          ffmpeg.stdin.once(
            "drain",
            resolve
          );
        });
      }

      if (
        frame % FPS === 0 ||
        frame === TOTAL_FRAMES - 1
      ) {
        console.log(
          `Frame ${frame + 1}/${TOTAL_FRAMES}`
        );
      }
    }

    ffmpeg.stdin.end();

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
      `MP4 created: ${OUTPUT}`
    );

  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
