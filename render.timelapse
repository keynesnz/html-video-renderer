const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const INPUT_HTML = path.resolve(__dirname, "source.html");
const OUTPUT_VIDEO = path.resolve(__dirname, "output.mp4");

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

// Maksimum video yang dihasilkan.
// Video akan berhenti pada durasi ini walaupun HTML lebih panjang.
const MAX_DURATION = 15;

function sleep(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

function waitForDrain(stream) {
  return new Promise((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
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

async function detectHtmlDuration(page) {
  const duration = await page.evaluate(() => {
    const durations = [];

    for (const element of document.querySelectorAll("*")) {
      const style = getComputedStyle(element);

      // CSS animation-duration
      for (const value of style.animationDuration.split(",")) {
        const seconds = parseFloat(value);

        if (value.trim().endsWith("ms")) {
          durations.push(seconds / 1000);
        } else if (value.trim().endsWith("s")) {
          durations.push(seconds);
        }
      }

      // CSS transition-duration
      for (const value of style.transitionDuration.split(",")) {
        const seconds = parseFloat(value);

        if (value.trim().endsWith("ms")) {
          durations.push(seconds / 1000);
        } else if (value.trim().endsWith("s")) {
          durations.push(seconds);
        }
      }
    }

    // Web Animations API
    if (document.getAnimations) {
      for (const animation of document.getAnimations()) {
        const timing = animation.effect?.getComputedTiming();

        if (timing?.duration && timing.duration !== "auto") {
          durations.push(Number(timing.duration) / 1000);
        }

        if (
          timing?.delay &&
          timing?.duration &&
          timing.duration !== "auto"
        ) {
          durations.push(
            (Number(timing.delay) + Number(timing.duration)) / 1000
          );
        }
      }
    }

    const validDurations = durations.filter(
      value => Number.isFinite(value) && value > 0
    );

    return validDurations.length > 0
      ? Math.max(...validDurations)
      : null;
  });

  return duration;
}

async function main() {
  if (!fs.existsSync(INPUT_HTML)) {
    throw new Error(`HTML file not found: ${INPUT_HTML}`);
  }

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    viewport: {
      width: WIDTH,
      height: HEIGHT
    },
    deviceScaleFactor: 1
  });

  page.on("console", message => {
    console.log(`[browser] ${message.text()}`);
  });

  page.on("pageerror", error => {
    console.error(`[browser error] ${error.message}`);
  });

  await page.goto(`file://${INPUT_HTML}`, {
    waitUntil: "networkidle"
  });

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
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      })
    );
  });

  const detectedDuration = await detectHtmlDuration(page);

  /*
   * Use the detected HTML duration.
   * Limit it to the first 15 seconds.
   *
   * If no CSS/Web Animation duration is found,
   * use MAX_DURATION as a fallback.
   */
  const duration = Math.min(
    detectedDuration || MAX_DURATION,
    MAX_DURATION
  );

  const totalFrames = Math.ceil(duration * FPS);
  const frameDuration = 1000 / FPS;

  console.log(
    `Detected HTML duration: ${
      detectedDuration || "unknown"
    } seconds`
  );

  console.log(
    `Rendering first ${duration} seconds at ${FPS} FPS`
  );

  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",

    "-f",
    "image2pipe",

    "-vcodec",
    "png",

    "-framerate",
    String(FPS),

    "-i",
    "pipe:0",

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

  // Start the real-time clock after the page is ready.
  const startTime = Date.now();

  for (let frame = 0; frame < totalFrames; frame++) {
    const scheduledTime =
      startTime + frame * frameDuration;

    const waitTime = scheduledTime - Date.now();

    if (waitTime > 0) {
      await sleep(waitTime);
    }

    const elapsedTime =
      (Date.now() - startTime) / 1000;

    // Make the real elapsed time available to the HTML.
    await page.evaluate(time => {
      document.documentElement.style.setProperty(
        "--elapsed-time",
        `${time}s`
      );

      window.dispatchEvent(
        new CustomEvent("render-time", {
          detail: {
            time
          }
        })
      );
    }, elapsedTime);

    // Wait for the browser to paint the animation.
    await page.evaluate(() => {
      return new Promise(resolve => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      });
    });

    const screenshot = await page.screenshot({
      type: "png"
    });

    if (!ffmpeg.stdin.write(screenshot)) {
      await waitForDrain(ffmpeg.stdin);
    }

    if (frame % FPS === 0) {
      console.log(
        `Frame ${frame}/${totalFrames}`
      );
    }
  }

  ffmpeg.stdin.end();

  await waitForProcess(ffmpeg);

  await browser.close();

  if (!fs.existsSync(OUTPUT_VIDEO)) {
    throw new Error("Video was not created");
  }

  if (fs.statSync(OUTPUT_VIDEO).size === 0) {
    throw new Error("Video file is empty");
  }

  console.log(`Video created: ${OUTPUT_VIDEO}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
