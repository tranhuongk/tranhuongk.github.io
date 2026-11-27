// The latest installer, from the public GitHub repo galaxvn/galax-login-releases (its workflow mirrors
// each release from the release server). Downloads go through github.com: Chrome blocked them from
// the shared sslip.io domain, which Safe Browsing flags as a whole.
import { useEffect, useState } from 'react'

const REPO = 'galaxvn/galax-login-releases'
export const LATEST_URL = `https://github.com/${REPO}/releases/latest/download/Galax-Login-Setup.exe`
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`

export interface Release {
  version: string
  setup_url: string
  latest_url: string
  size: number
  sha256: string
  released: string
  /** The macOS .dmg of the same release; empty until a release carries one. */
  mac_url: string
  mac_size: number
}

/** Shown until (or if) the API cannot be read: the stable link still gets the newest build. */
const FALLBACK: Release = { version: '', setup_url: LATEST_URL, latest_url: LATEST_URL, size: 0, sha256: '', released: '', mac_url: '', mac_size: 0 }

interface GhAsset { name: string; size: number; digest?: string; browser_download_url: string }

export function useRelease(): Release {
  const [r, setR] = useState(FALLBACK)
  useEffect(() => {
    const ctl = new AbortController()
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { signal: ctl.signal, headers: { Accept: 'application/vnd.github+json' } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((d: { tag_name: string; published_at: string; assets: GhAsset[] }) => {
        const setup = d.assets.find((a) => /^Galax-Login-[\d.]+-Setup\.exe$/.test(a.name)) ?? d.assets.find((a) => a.name.endsWith('.exe'))
        if (!setup) return
        const mac = d.assets.find((a) => /^Galax-Login-[\d.]+-macOS\.dmg$/.test(a.name))
        setR({
          version: d.tag_name.replace(/^v/, ''),
          setup_url: setup.browser_download_url,
          latest_url: LATEST_URL,
          size: setup.size,
          sha256: setup.digest?.replace(/^sha256:/, '') ?? '',
          released: d.published_at.slice(0, 10),
          mac_url: mac ? `https://github.com/${REPO}/releases/latest/download/Galax-Login-macOS.dmg` : '',
          mac_size: mac?.size ?? 0,
        })
      })
      .catch(() => {})
    return () => ctl.abort()
  }, [])
  return r
}

export const megabytes = (n: number) => (n ? `${(n / 1048576).toFixed(1)} MB` : '')
export const vnDate = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '')
