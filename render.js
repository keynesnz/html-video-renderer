const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const INPUT_HTML = path.resolve(__dirname, "source.html");
const OUTPUT_VIDEO = path.resolve(__dirname, "output.mp4");
const VIDEO_DIR = path.resolve(__dirname, ".video-recording");

const WIDTH = 1920;
const HEIGHT = 1080;

// Record only the first 15 seconds.
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

  /*
   * Playwright records the browser in real time.
   * This preserves the original HTML animation speed.
   */
  const browser = await chromium.launch({
    headless: true
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

  console.log(`Opening ${INPUT_HTML}`);

  await page.goto(`file://${INPUT_HTML}`, {
    waitUntil: "networkidle"
  });

  /*
   * Wait for fonts and images before starting the recording timer.
   */
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

  /*
   * Give the browser one frame to paint the fully loaded page.
   */
  await page.evaluate(() => {
    return new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  });

  console.log(
    `Recording first ${MAX_DURATION_SECONDS} seconds in real time...`
  );

  const startTime = Date.now();

  /*
   * The page animation runs normally.
   * No frame seeking and no manual screenshot timing are used.
   */
  await sleep(MAX_DURATION_SECONDS * 1000);

  const actualDuration =
    (Date.now() - startTime) / 1000;

  console.log(
    `Recording finished after ${actualDuration.toFixed(2)} seconds`
  );

  /*
   * Closing the page/context finalizes the Playwright video.
   */
  await page.close();

  const video = page.video();

  if (!video) {
    throw new Error("Playwright did not create a video");
  }

  const webmPath = await video.path();

  await context.close();
  await browser.close();

  if (!fs.existsSync(webmPath)) {
    throw new Error(`Recorded video not found: ${webmPath}`);
  }

  console.log(`Recorded browser video: ${webmPath}`);

  /*
   * Convert the real-time WebM recording to MP4.
   * -t ensures that only the first 15 seconds are kept.
   */
  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",

    "-i",
    webmPath,

    "-vf", "fps=60",
    
    "-t",
    String(MAX_DURATION_SECONDS),

    "-an",

    "-c:v",
    "libx264",

    "-preset",
    "medium",

    "-crf",
    "18",

    "-pix_fmt",
    "yuv420p",

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

  console.log(
    `Finished creating ${OUTPUT_VIDEO}`
  );

  console.log(
    `File size: ${(outputSize / 1024 / 1024).toFixed(2)} MB`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
