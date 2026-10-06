export async function pickImageFile(title: string): Promise<{ path: string; bytes: Uint8Array } | null> {
  // A native dialog path is NOT a file.read capability. The browser's File
  // object grants access only to the file the user explicitly selected.
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.jpg,.jpeg,.png,.webp'; input.multiple = false
    input.style.display = 'none'; document.body.append(input)
    const previousFocus = document.activeElement as HTMLElement | null
    let done = false, reading = false, opened = false, focusTimer: ReturnType<typeof setTimeout> | null = null
    let dialog: HTMLDialogElement | null = null
    function finish(result: { path: string; bytes: Uint8Array } | null, error?: unknown) {
      if (done) return
      done = true; if (focusTimer) clearTimeout(focusTimer)
      window.removeEventListener('focus', focused); input.remove()
      dialog?.close(); dialog?.remove()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
      error ? reject(error) : resolve(result)
    }
    function focused() {
      if (!opened || reading) return
      focusTimer = setTimeout(() => { if (!reading && !input.files?.length) finish(null) }, 350)
    }
    input.addEventListener('cancel', () => finish(null))
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) { finish(null); return }
      reading = true
      try {
        if (!/\.(jpe?g|png|webp)$/i.test(file.name)) throw new Error('请选择 JPG、PNG 或 WebP 图片。')
        if (file.size > 8_000_000) throw new Error('请选择小于 8MB 的图片。')
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (!bytes.length) throw new Error('图片文件为空。')
        finish({ path: file.name, bytes })
      } catch (error) { finish(null, error) }
    })
    window.addEventListener('focus', focused)
    function open() {
      opened = true
      try { if (input.showPicker) input.showPicker(); else input.click() }
      catch { opened = false; prompt() }
    }
    function prompt() {
      if (dialog || done) return
      dialog = document.createElement('dialog'); dialog.className = 'image-picker-dialog'
      const heading = document.createElement('h2'); heading.textContent = title
      const note = document.createElement('p'); note.textContent = '选择图片后仅读取该文件，不需要授予文件夹访问权限。'
      const browse = document.createElement('button'); browse.type = 'button'; browse.className = 'primary-button'; browse.textContent = '选择图片…'
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary-button'; cancel.textContent = '取消'
      browse.addEventListener('click', open); cancel.addEventListener('click', () => finish(null))
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null) })
      dialog.append(heading, note, browse, cancel); document.body.append(dialog); dialog.showModal(); browse.focus()
    }
    if (navigator.userActivation?.isActive === false) prompt()
    else open()
  })
}
