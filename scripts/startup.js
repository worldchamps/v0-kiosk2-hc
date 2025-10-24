const { spawn } = require("child_process")
const path = require("path")

console.log("🚀 Starting TheBeachStay Kiosk...\n")

// Step 1: Build the application
console.log("📦 Building application...")
const build = spawn("npm", ["run", "build"], {
  stdio: "inherit",
  shell: true,
})

build.on("close", (code) => {
  if (code !== 0) {
    console.error("❌ Build failed!")
    process.exit(1)
  }

  console.log("✅ Build completed!\n")

  // Step 2: Start Next.js server in a new window
  console.log("🌐 Starting Next.js server in new window...")
  const startCmd = process.platform === "win32" ? `start "Next.js Server" cmd /k "npm run start"` : "npm run start"

  spawn(startCmd, [], {
    shell: true,
    detached: true,
    stdio: "ignore",
  })

  // Wait a bit for the server to start
  console.log("⏳ Waiting for server to start...\n")
  setTimeout(() => {
    // Step 3: Start Electron in a new window
    console.log("⚡ Starting Electron in new window...")
    const electronCmd =
      process.platform === "win32" ? `start "Electron App" cmd /k "npm run electron"` : "npm run electron"

    spawn(electronCmd, [], {
      shell: true,
      detached: true,
      stdio: "ignore",
    })

    console.log("✅ All processes started!")
    console.log("📝 Check the new windows for Next.js server and Electron app.")

    // Keep this process alive for a moment to show messages
    setTimeout(() => {
      process.exit(0)
    }, 2000)
  }, 5000)
})
