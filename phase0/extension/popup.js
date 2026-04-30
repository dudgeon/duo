const btn = document.getElementById('ping')
const log = document.getElementById('log')

function append(text, cls) {
  const line = document.createElement('div')
  line.textContent = `${new Date().toLocaleTimeString()} ${text}`
  if (cls) line.className = cls
  log.appendChild(line)
  log.scrollTop = log.scrollHeight
}

btn.addEventListener('click', () => {
  const nonce = Math.random().toString(36).slice(2, 10)
  const t0 = performance.now()
  append(`→ ping ${nonce}`)
  chrome.runtime.sendMessage({ type: 'ping-helper', nonce }, (response) => {
    const elapsed = (performance.now() - t0).toFixed(1)
    if (chrome.runtime.lastError) {
      append(`✗ runtime error: ${chrome.runtime.lastError.message}`, 'err')
      return
    }
    if (response && response.ok) {
      append(
        `✓ pong in ${response.elapsedMs}ms ` +
        `(popup→sw→helper→sw→popup ${elapsed}ms) ` +
        `pid=${response.helperPid} msg#${response.messageCount}`,
        'ok'
      )
    } else {
      append(`✗ ${response ? response.error : 'no response'}`, 'err')
    }
  })
})
