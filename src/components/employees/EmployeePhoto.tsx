"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { Users } from "lucide-react"
import { api } from "@/services/api"
import { shouldRequestSignedStorageUrl } from "@/lib/storageAsset"

type EmployeePhotoProps = {
  value?: string | null
  alt: string
  size?: number
  className?: string
}

/** Resolve private photos only when their visible preview approaches the viewport. */
export function EmployeePhoto({ value, alt, size = 44, className = "" }: EmployeePhotoProps) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const [resolved, setResolved] = useState<{ source: string; url: string | null; failed: boolean } | null>(null)
  const source = value || ""
  const privatePhoto = shouldRequestSignedStorageUrl(source)
  const result = resolved?.source === source ? resolved : null
  const url = privatePhoto ? result?.url : source

  useEffect(() => {
    if (!source || !privatePhoto) return
    let current = true
    let requested = false
    const request = () => {
      if (requested || !current) return
      requested = true
      void api.getEmployeePhotoUrl(source).then(photoUrl => {
        if (current) setResolved({ source, url: photoUrl, failed: !photoUrl })
      }).catch(() => {
        if (current) setResolved({ source, url: null, failed: true })
      })
    }
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer?.disconnect()
        request()
      }
    }, { rootMargin: "100px" })
    if (observer && containerRef.current) observer.observe(containerRef.current)
    else request()
    return () => { current = false; observer?.disconnect() }
  }, [source, privatePhoto])

  return <span ref={containerRef} className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-slate-400 ${className}`} style={{ width: size, height: size }}>
    {url && !result?.failed ? <Image src={url} alt={alt} width={size} height={size} className="h-full w-full object-cover" unoptimized onError={() => setResolved({ source, url: null, failed: true })} /> : <span role="img" aria-label={source ? `Foto indisponível de ${alt}` : `Sem foto de ${alt}`} title={source ? "A foto não foi carregada; o cadastro continua disponível." : "Sem foto cadastrada"} className="flex h-full w-full items-center justify-center"><Users aria-hidden="true" className="h-1/2 w-1/2" /></span>}
  </span>
}
