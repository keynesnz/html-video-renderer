const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const INPUT_HTML = path.resolve(__dirname, "source.html");
const OUTPUT_VIDEO = path.resolve(__dirname, "output.mp4");

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;
const DURATION = 15;

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
          new Error(`ffmpeg exited with code ${code}\n\n${stderr}`)
        );
      }
    });
  });
}

async function main() {
  if (!fs.existsSync(INPUT_HTML)) {
    throw new Error(`Input file not found: ${INPUT_HTML}`);
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
    console.error("[page error]", error);
  });

  await page.goto(`file://${INPUT_HTML}`, {
    waitUntil: "networkidle"
  });

  // Tell the page that it is being rendered frame-by-frame.
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-rendering", "true");
  });

  // Wait for fonts, images, and layout to finish.
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }

    const images = Array.from(document.images);

    await Promise.all(
      images.map(image => {
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

  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",

    // The input consists of consecutive PNG screenshots.
    "-f",
    "image2pipe",
    "-vcodec",
    "png",
    "-framerate",
    String(FPS),
    "-i",
    "pipe:0",

    // Encode as a broadly compatible H.264 MP4.
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

  const totalFrames = Math.ceil(DURATION * FPS);

  console.log(
    `Rendering ${totalFrames} frames at ${FPS} FPS...`
  );

  for (let frame = 0; frame < totalFrames; frame++) {
    const time = frame / FPS;

    // Move the HTML animation to the exact video timestamp.
    await page.evaluate(async ({ frame, time, fps }) => {
      if (typeof window.seekToFrame === "function") {
        await window.seekToFrame(frame, time, fps);
      } else {
        document.documentElement.style.setProperty(
          "--render-time",
          `${time}s`
        );
      }

      // Allow the browser to apply styles and paint the frame.
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      });
    }, { frame, time, fps: FPS });

    const screenshot = await page.screenshot({
      type: "png"
    });

    if (!ffmpeg.stdin.write(screenshot)) {
      await waitForDrain(ffmpeg.stdin);
    }

    if (frame % FPS === 0) {
      console.log(
        `Rendered ${frame}/${totalFrames} frames`
      );
    }
  }

  ffmpeg.stdin.end();

  await waitForProcess(ffmpeg);
  await browser.close();

  console.log(`Finished: ${OUTPUT_VIDEO}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
