// Only the deployment workstation and the update server use cloud credentials.
// Devices never receive a service-account key or direct bucket access.
const { initializeApp, applicationDefault, getApps } = require("firebase-admin/app")
const { getStorage } = require("firebase-admin/storage")
function cloudStore() {
  const name = process.env.KIOSK_UPDATE_BUCKET
  if (!name) throw new Error("KIOSK_UPDATE_BUCKET is required (dedicated private bucket)")
  if (!getApps().length) initializeApp({ credential: applicationDefault() })
  const bucket = getStorage().bucket(name)
  return {
    bucket,
    async get(key) {
      try {
        const file = bucket.file(key)
        const [metadata] = await file.getMetadata()
        const [bytes] = await bucket.file(key, { generation: metadata.generation }).download()
        return { value: JSON.parse(bytes.toString("utf8")), generation: metadata.generation }
      } catch (error) { if (Number(error.code) === 404) return { value: null, generation: 0 }; throw error }
    },
    async put(key, value, generation) {
      await bucket.file(key).save(JSON.stringify(value), {
        resumable: false, contentType: "application/json",
        preconditionOpts: { ifGenerationMatch: generation },
      })
    },
  }
}
module.exports = { cloudStore }
