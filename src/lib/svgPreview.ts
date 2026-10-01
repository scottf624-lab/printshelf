export async function svgBufferToDataUrl(buffer: ArrayBuffer): Promise<string> {
  const text = new TextDecoder('utf-8').decode(buffer)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
}

export function isSvgExt(ext: string): boolean {
  return ext.toLowerCase() === 'svg'
}
