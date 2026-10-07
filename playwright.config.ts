import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3211);
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: ci ? 1 : 0,
  reporter: ci ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Background (new headless) Chromium. Locally it has real WebGPU; CI runners have no GPU,
        // so WebGPU is turned off there and the renderer falls back to WebGL 2.
        channel: "chromium",
        launchOptions: {
          args: ci ? ["--disable-features=WebGPU", "--use-angle=swiftshader"] : ["--enable-unsafe-webgpu"],
        },
      },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
});
