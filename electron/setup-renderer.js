const register = async (restart = false) => {
  const button = document.getElementById("register"), status = document.getElementById("status")
  button.disabled = true
  document.getElementById("restart").disabled = true
  status.textContent = "등록을 진행하고 있습니다…"
  try { const result = await window.kioskSetup.register(restart); status.textContent = result.error || "등록이 완료되었습니다." }
  catch { status.textContent = "등록 연결을 확인하고 다시 시도해 주세요." }
  finally { button.disabled = false; document.getElementById("restart").disabled = false }
}
document.getElementById("register").addEventListener("click", () => register())
document.getElementById("restart").addEventListener("click", () => register(true))
