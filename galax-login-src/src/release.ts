// The latest installer, as published by the Galax Login release workflow on the VPS.
import { useEffect, useState } from 'react'

export const DOWNLOAD_BASE = 'https://dl.103-75-184-121.sslip.io/galax'

export interface Release {
  version: string
  setup_url: string
  latest_url: string
  size: number
  sha256: string
  released: string
}

/** Shown until (or if) the manifest cannot be read: the stable link still gets the newest build. */
const FALLBACK: Release = {
  version: '',
  setup_url: `${DOWNLOAD_BASE}/Galax-Login-Setup.exe`,
  latest_url: `${DOWNLOAD_BASE}/Galax-Login-Setup.exe`,
  size: 0,
  sha256: '',
  released: '',
}

export function useRelease(): Release {
  const [r, setR] = useState(FALLBACK)
  useEffect(() => {
    const ctl = new AbortController()
    fetch(`${DOWNLOAD_BASE}/latest.json`, { signal: ctl.signal, cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((d: Release) => d.version && setR(d))
      .catch(() => {})
    return () => ctl.abort()
  }, [])
  return r
}

export const megabytes = (n: number) => (n ? `${(n / 1048576).toFixed(1)} MB` : '')
export const vnDate = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '')
