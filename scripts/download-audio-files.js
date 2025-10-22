const https = require("https")
const http = require("http")
const fs = require("fs")
const path = require("path")

// Create audio directory if it doesn't exist
const audioDir = path.join(__dirname, "..", "public", "audio")
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true })
}

// Audio files to download
const audioFiles = [
  {
    url: "https://pjtmy8ogj.blob.vercel-storage.com/reservation-name-prompt-2025-01-10T06_11_56_000Z-Aq8YqVZGJ0v3kZGJ0v3kZGJ0v3kZ.mp3",
    filename: "reservation-prompt.mp3",
    description: "예약자명 입력 안내",
  },
  {
    url: "https://pjtmy8ogj.blob.vercel-storage.com/reservation-found-2025-01-10T06_11_56_000Z-Bq8YqVZGJ0v3kZGJ0v3kZGJ0v3kZ.mp3",
    filename: "reservation-found.mp3",
    description: "예약 확인됨 안내",
  },
  {
    url: "https://pjtmy8ogj.blob.vercel-storage.com/reservation-not-found-2025-01-10T06_11_56_000Z-Cq8YqVZGJ0v3kZGJ0v3kZGJ0v3kZ.mp3",
    filename: "reservation-not-found.mp3",
    description: "예약 없음 안내",
  },
  {
    url: "https://pjtmy8ogj.blob.vercel-storage.com/ABuilding%20Guide-2025-01-10T06_11_56_000Z-Dq8YqVZGJ0v3kZGJ0v3kZGJ0v3kZ.mp3",
    filename: "building-a-guide.mp3",
    description: "A동 안내",
  },
  {
    url: "https://pjtmy8ogj.blob.vercel-storage.com/BBuilding%20Guide-2025-01-10T06_11_56_000Z-Eq8YqVZGJ0v3kZGJ0v3kZGJ0v3kZ.mp3",
    filename: "building-b-guide.mp3",
    description: "B동 안내",
  },
  {
    url: "https://pjtmy8ogj.blob.vercel-storage.com/CBuilding%20Guide-2025-01-10T06_11_56_000Z-Fq8YqVZGJ0v3kZGJ0v3kZGJ0v3kZ.mp3",
    filename: "building-c-guide.mp3",
    description: "C동 안내",
  },
  {
    url: "https://pjtmy8ogj.blob.vercel-storage.com/DBuilding%20Guide-2025-01-10T06_11_56_000Z-Gq8YqVZGJ0v3kZGJ0v3kZGJ0v3kZ.mp3",
    filename: "building-d-guide.mp3",
    description: "D동 안내",
  },
  {
    url: "https://pjtmy8ogj.blob.vercel-storage.com/CampBuilding%20Guide-2025-01-10T06_11_56_000Z-Hq8YqVZGJ0v3kZGJ0v3kZGJ0v3kZ.mp3",
    filename: "building-camp-guide.mp3",
    description: "캠프동 안내",
  },
  {
    url: "https://pjtmy8ogj.blob.vercel-storage.com/ElevenLabs_2025-10-11T06_11_56_000Z-Iq8YqVZGJ0v3kZGJ0v3kZGJ0v3kZ.mp3",
    filename: "idle-welcome.mp3",
    description: "대기화면 환영 멘트",
  },
  {
    url: "https://pjtmy8ogj.blob.vercel-storage.com/BGM-2025-01-10T06_11_56_000Z-Jq8YqVZGJ0v3kZGJ0v3kZGJ0v3kZ.mp3",
    filename: "bgm.mp3",
    description: "배경음악",
  },
]

// Download function
function downloadFile(url, filepath, description) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http

    console.log(`Downloading: ${description} (${filepath})...`)

    const file = fs.createWriteStream(filepath)

    protocol
      .get(url, (response) => {
        if (response.statusCode === 200) {
          response.pipe(file)
          file.on("finish", () => {
            file.close()
            console.log(`✓ Downloaded: ${description}`)
            resolve()
          })
        } else if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          file.close()
          fs.unlinkSync(filepath)
          downloadFile(response.headers.location, filepath, description).then(resolve).catch(reject)
        } else {
          file.close()
          fs.unlinkSync(filepath)
          reject(new Error(`Failed to download ${url}: ${response.statusCode}`))
        }
      })
      .on("error", (err) => {
        file.close()
        fs.unlinkSync(filepath)
        reject(err)
      })
  })
}

// Download all files
async function downloadAll() {
  console.log("Starting audio file downloads...\n")

  for (const file of audioFiles) {
    const filepath = path.join(audioDir, file.filename)
    try {
      await downloadFile(file.url, filepath, file.description)
    } catch (error) {
      console.error(`✗ Error downloading ${file.description}:`, error.message)
    }
  }

  console.log("\nAll downloads complete!")
  console.log(`Audio files saved to: ${audioDir}`)
}

downloadAll()
