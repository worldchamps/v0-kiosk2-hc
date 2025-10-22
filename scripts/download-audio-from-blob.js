import { list } from "@vercel/blob"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function downloadAudioFiles() {
  try {
    console.log("🔍 Blob 스토리지에서 파일 목록 가져오는 중...")

    // List all files from Blob storage
    const { blobs } = await list()

    // Filter for audio files only
    const audioFiles = blobs.filter(
      (blob) =>
        blob.pathname.endsWith(".mp3") ||
        blob.pathname.endsWith(".wav") ||
        blob.pathname.endsWith(".m4a") ||
        blob.contentType?.startsWith("audio/"),
    )

    console.log(`\n✅ ${audioFiles.length}개의 음성 파일을 찾았습니다.\n`)

    // Create audio directory if it doesn't exist
    const audioDir = path.join(__dirname, "..", "public", "audio")
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true })
      console.log("📁 /public/audio/ 폴더 생성 완료\n")
    }

    // Download each audio file
    let successCount = 0
    let failCount = 0

    for (const blob of audioFiles) {
      const filename = blob.pathname.split("/").pop() || "unknown.mp3"
      const filepath = path.join(audioDir, filename)

      try {
        console.log(`⬇️  다운로드 중: ${filename}`)
        console.log(`   URL: ${blob.url}`)

        const response = await fetch(blob.url)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const buffer = await response.arrayBuffer()
        fs.writeFileSync(filepath, Buffer.from(buffer))

        console.log(`✅ 저장 완료: ${filepath}`)
        console.log(`   크기: ${(blob.size / 1024).toFixed(2)} KB\n`)
        successCount++
      } catch (error) {
        console.error(`❌ 다운로드 실패: ${filename}`)
        console.error(`   에러: ${error.message}\n`)
        failCount++
      }
    }

    console.log("\n" + "=".repeat(50))
    console.log(`✅ 성공: ${successCount}개`)
    console.log(`❌ 실패: ${failCount}개`)
    console.log("=".repeat(50))

    if (successCount > 0) {
      console.log("\n📋 다음 단계:")
      console.log("1. /public/audio/ 폴더의 파일명을 확인하세요")
      console.log("2. lib/audio-utils.ts에서 파일명이 일치하는지 확인하세요")
      console.log("3. git add public/audio/ && git commit -m 'Add audio files'")
    }
  } catch (error) {
    console.error("❌ 오류 발생:", error)
    process.exit(1)
  }
}

downloadAudioFiles()
