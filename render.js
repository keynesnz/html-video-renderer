const puppeteer = require("puppeteer");
const { spawn } = require("child_process");
const path = require("path");

const FPS = 30;
const DURATION = 15;

const WIDTH = 1080;
const HEIGHT = 1920;

const TOTAL_FRAMES =
  FPS * DURATION;

const INPUT =
  path.resolve(
    process.env.INPUT || "source.html"
  );

const OUTPUT =
  path.resolve(
    process.env.OUTPUT || "output.mp4"
  );


async function main() {

  console.log(
    "Starting browser..."
  );


  const browser =
    await puppeteer.launch({

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

    const page =
      await browser.newPage();


    await page.setViewport({

      width: WIDTH,

      height: HEIGHT,

      deviceScaleFactor: 1

    });


    console.log(
      "Loading:",
      INPUT
    );


    await page.goto(

      `file://${INPUT}`,

      {
        waitUntil:
          "networkidle0"
      }

    );


    console.log(
      "Page loaded."
    );


    /*
     * Wait for fonts.
     */

    await page.evaluate(
      async () => {

        if (document.fonts) {

          await document.fonts.ready;

        }

      }
    );


    /*
     * Tell animation that
     * rendering is active.
     */

    await page.evaluate(
      () => {

        document.documentElement
          .dataset
          .rendering =
          "true";

      }
    );


    console.log(
      `Rendering ${TOTAL_FRAMES} frames...`
    );


    /*
     * Start FFmpeg.
     */

    const ffmpeg =
      spawn(

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
     * Render frames.
     */

    for (
      let frame = 0;
      frame < TOTAL_FRAMES;
      frame++
    ) {

      const time =
        frame / FPS;


      await page.evaluate(

        async (
          frame,
          time,
          fps
        ) => {

          /*
           * Preferred API.
           */

          if (
            typeof window.seekToFrame ===
            "function"
          ) {

            await window.seekToFrame(
              frame,
              time,
              fps
            );

          } else {

            /*
             * Fallback.
             */

            window.__renderTime =
              time;

          }

        },

        frame,
        time,
        FPS

      );


      /*
       * Wait for browser paint.
       */

      await page.evaluate(

        () =>
          new Promise(
            resolve =>
              requestAnimationFrame(
                () =>
                  requestAnimationFrame(
                    resolve
                  )
              )
          )

      );


      /*
       * Capture PNG.
       */

      const image =
        await page.screenshot({

          type: "png"

        });


      /*
       * Backpressure.
       */

      if (
        !ffmpeg.stdin.write(
          image
        )
      ) {

        await new Promise(
          resolve =>
            ffmpeg.stdin.once(
              "drain",
              resolve
            )
        );

      }


      if (
        frame % FPS === 0 ||
        frame ===
          TOTAL_FRAMES - 1
      ) {

        console.log(
          `Frame ${frame + 1}/${TOTAL_FRAMES}`
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
      "MP4 created:"
    );

    console.log(
      OUTPUT
    );


  } finally {

    await browser.close();

  }

}


main().catch(
  error => {

    console.error(
      error
    );

    process.exit(1);

  }
);
