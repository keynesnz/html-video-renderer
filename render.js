const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const INPUT_HTML = path.resolve(__dirname, "source.html");
const OUTPUT_VIDEO = path.resolve(__dirname, "output.mp4");
const VIDEO_DIR = path.resolve(__dirname, ".video-recording");

const WIDTH = 1920;
const HEIGHT = 1080;

// Only render the first 15 seconds.
const MAX_DURATION_SECONDS = 15;

function sleep(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

function waitForProcess(process) {
  return new Promise((resolve, reject) => {
    let stderr = "";

    process.stderr.on("data", data => {
      stderr += data.toString();
    });

    process.on("error", reject);

    process.on("close", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `FFmpeg exited with code ${code}\n${stderr}`
          )
        );
      }
    });
  });
}

async function waitForPageAssets(page) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    await Promise.all(
      Array.from(document.images).map(image => {
        if (image.complete) {
          return Promise.resolve();
        }

        return new Promise(resolve => {
          image.addEventListener("load", resolve, {
            once: true
          });

          image.addEventListener("error", resolve, {
            once: true
          });
        });
      })
    );
  });
}

async function main() {
  if (!fs.existsSync(INPUT_HTML)) {
    throw new Error(`HTML file not found: ${INPUT_HTML}`);
  }

  fs.rmSync(VIDEO_DIR, {
    recursive: true,
    force: true
  });

  fs.mkdirSync(VIDEO_DIR, {
    recursive: true
  });

  if (fs.existsSync(OUTPUT_VIDEO)) {
    fs.rmSync(OUTPUT_VIDEO);
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--run-all-compositor-stages-before-draw",
      "--enable-gpu-rasterization",
      "--enable-zero-copy"
    ]
  });

  const context = await browser.newContext({
    viewport: {
      width: WIDTH,
      height: HEIGHT
    },

    recordVideo: {
      dir: VIDEO_DIR,
      size: {
        width: WIDTH,
        height: HEIGHT
      }
    }
  });

  const page = await context.newPage();

  page.on("console", message => {
    console.log(`[browser] ${message.text()}`);
  });

  page.on("pageerror", error => {
    console.error(`[browser error] ${error.message}`);
  });

  try {
    console.log(`Opening ${INPUT_HTML}`);

    await page.goto(`file://${INPUT_HTML}`, {
      waitUntil: "networkidle"
    });

    await waitForPageAssets(page);

    /*
     * Allow the browser to paint the fully loaded page
     * before the recording timer starts.
     */
    await page.evaluate(() => {
      return new Promise(resolve => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      });
    });

    console.log(
      `Recording first ${MAX_DURATION_SECONDS} seconds...`
    );

    /*
     * Playwright records the page in real time.
     * Do not manually seek animation frames here.
     */
    await sleep(MAX_DURATION_SECONDS * 1000);

    const video = page.video();

    if (!video) {
      throw new Error("Playwright video recording was not created");
    }

    /*
     * Closing the page finalizes the WebM recording.
     */
    await page.close();

    const webmPath = await video.path();

    await context.close();
    await browser.close();

    if (!fs.existsSync(webmPath)) {
      throw new Error(`Recorded WebM file not found: ${webmPath}`);
    }

    console.log(`Recorded WebM: ${webmPath}`);

    /*
     * Convert WebM to a smoother 60-FPS MP4.
     *
     * Playwright's recording can contain fewer frames than the
     * browser animation. minterpolate creates intermediate frames
     * instead of simply duplicating frames.
     */
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",

      "-i",
      webmPath,

      "-t",
      String(MAX_DURATION_SECONDS),

      "-vf",
      "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1",

      "-an",

      "-c:v",
      "libx264",

      "-preset",
      "slow",

      "-crf",
      "16",

      "-pix_fmt",
      "yuv420p",

      "-r",
      "60",

      "-movflags",
      "+faststart",

      "-y",
      OUTPUT_VIDEO
    ]);

    await waitForProcess(ffmpeg);

    if (!fs.existsSync(OUTPUT_VIDEO)) {
      throw new Error("MP4 video was not created");
    }

    const outputSize = fs.statSync(OUTPUT_VIDEO).size;

    if (outputSize === 0) {
      throw new Error("MP4 video is empty");
    }

    console.log(`Video created: ${OUTPUT_VIDEO}`);
    console.log(
      `File size: ${(outputSize / 1024 / 1024).toFixed(2)} MB`
    );
  } catch (error) {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});

    throw error;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
